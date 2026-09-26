'use strict';

const request = require('supertest');
const { setupStrapi, cleanupStrapi } = require('./strapi');
const { setPublicPermissions } = require('./helpers/permissions');
const { migrateSliderItems } = require('../src/migrations/slider-items');
const {
  formatCreditHtml,
  findPublishedArticle,
} = require('../src/plugins/fediverse/server/src/services/articles');

const ARTICLE_UID = 'api::article.article';

const ccBySa = {
  kind: 'photo',
  author: 'Danielfjio',
  authorUrl: 'https://commons.wikimedia.org/wiki/User:Danielfjio',
  source: 'Wikimedia Commons',
  sourceUrl: 'https://commons.wikimedia.org/wiki/File:Paisaje_Sumapaz,_Colombia.jpg',
  license: 'cc-by-sa-4.0',
  modifications: 'recortada',
};

const ownWork = {
  kind: 'illustration',
  author: 'Alejandro Ramírez',
  source: 'BogDev',
  license: 'own-work',
};

async function createImage(name) {
  return strapi.db.query('plugin::upload.file').create({
    data: {
      name,
      hash: name.replace(/\W/g, '_'),
      ext: '.png',
      mime: 'image/png',
      size: 1,
      url: `/uploads/${name}`,
      provider: 'local',
    },
  });
}

describe('Credit line for federated articles', () => {
  it('formats a CC BY-SA credit with its links', () => {
    expect(formatCreditHtml(ccBySa, 'es')).toBe(
      'Foto: <a href="https://commons.wikimedia.org/wiki/User:Danielfjio" rel="nofollow noopener">Danielfjio</a>' +
        ' · <a href="https://commons.wikimedia.org/wiki/File:Paisaje_Sumapaz,_Colombia.jpg" rel="nofollow noopener">Wikimedia Commons</a>' +
        ' · <a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="license nofollow noopener">CC BY-SA 4.0</a>' +
        ' · recortada'
    );
  });

  it('formats own work without links, in the article language', () => {
    expect(formatCreditHtml(ownWork, 'en')).toBe(
      'Illustration: Alejandro Ramírez · BogDev · own work'
    );
  });

  it('escapes the editor text and returns null without a credit', () => {
    expect(formatCreditHtml({ license: 'permission', author: '<b>Ana</b>' }, 'es')).toBe(
      'Foto: &lt;b&gt;Ana&lt;/b&gt; · uso con permiso'
    );
    expect(formatCreditHtml(null, 'es')).toBeNull();
  });
});

describe('Image captions and credits', () => {
  const create = (data) => strapi.documents(ARTICLE_UID).create({ data });
  let images;

  beforeAll(async () => {
    await setupStrapi();
    await setPublicPermissions('article', ['find', 'findOne']);
    images = await Promise.all(['sumapaz.png', 'frailejon.png', 'laguna.png'].map(createImage));
  });

  afterAll(async () => {
    await cleanupStrapi();
  });

  it('returns caption and credit per image through the public API', async () => {
    const draft = await create({
      title: 'Figures',
      slug: 'figures',
      cover: images[0].id,
      coverCredit: ccBySa,
      blocks: [
        {
          __component: 'shared.media',
          file: images[0].id,
          caption: 'Una laguna del Páramo de Sumapaz.',
          credit: ccBySa,
        },
        {
          __component: 'shared.slider',
          items: [
            { file: images[1].id, caption: 'Frailejón', credit: ownWork },
            { file: images[2].id, caption: 'Laguna', credit: ccBySa },
          ],
        },
      ],
    });
    await strapi.documents(ARTICLE_UID).publish({ documentId: draft.documentId });

    const res = await request(strapi.server.httpServer)
      .get('/api/articles')
      .query({
        filters: { slug: { $eq: 'figures' } },
        populate: {
          cover: true,
          coverCredit: true,
          blocks: {
            on: {
              'shared.media': { populate: { file: true, credit: true } },
              'shared.slider': { populate: { items: { populate: { file: true, credit: true } } } },
            },
          },
        },
      })
      .expect(200);

    const [article] = res.body.data;
    expect(article.cover.url).toBe('/uploads/sumapaz.png');
    expect(article.coverCredit).toMatchObject(ccBySa);

    const [media, slider] = article.blocks;
    expect(media.caption).toBe('Una laguna del Páramo de Sumapaz.');
    expect(media.credit).toMatchObject(ccBySa);
    expect(media.file.url).toBe('/uploads/sumapaz.png');

    expect(slider.items.map((item) => item.file.url)).toEqual([
      '/uploads/frailejon.png',
      '/uploads/laguna.png',
    ]);
    expect(slider.items.map((item) => item.caption)).toEqual(['Frailejón', 'Laguna']);
    expect(slider.items[0].credit).toMatchObject(ownWork);
    expect(slider.items[1].credit).toMatchObject(ccBySa);

    // The federated article carries the cover's attribution.
    const federated = await findPublishedArticle(strapi, draft.documentId);
    expect(federated.image.creditHtml).toContain('CC BY-SA 4.0');
  });

  it('rejects an attribution license without author or source link', async () => {
    await expect(
      create({ title: 'No author', coverCredit: { ...ccBySa, author: '' } })
    ).rejects.toThrow(/cc-by-sa-4.0 needs author \(coverCredit\)/);

    await expect(
      create({
        title: 'No source',
        blocks: [
          {
            __component: 'shared.slider',
            items: [{ file: images[1].id, credit: { ...ccBySa, sourceUrl: null } }],
          },
        ],
      })
    ).rejects.toThrow(/needs sourceUrl \(blocks\.0\.items\.0\.credit\)/);
  });

  it('rejects a malformed URL', async () => {
    await expect(
      create({
        title: 'Bad URL',
        blocks: [
          {
            __component: 'shared.media',
            file: images[0].id,
            credit: { ...ccBySa, authorUrl: 'commons.wikimedia.org/wiki/User:Danielfjio' },
          },
        ],
      })
    ).rejects.toThrow(/authorUrl .* must be an http\(s\) URL \(blocks\.0\.credit\)/);
  });

  it('accepts own work without links, and blocks without caption or credit', async () => {
    await expect(
      create({
        title: 'Plain figures',
        coverCredit: { kind: 'illustration', license: 'own-work' },
        blocks: [
          { __component: 'shared.media', file: images[0].id },
          { __component: 'shared.slider', files: [images[1].id] },
        ],
      })
    ).resolves.toBeTruthy();
  });

  it('copies legacy slider files into items once, in order, keeping files', async () => {
    const draft = await create({
      title: 'Legacy slider',
      blocks: [{ __component: 'shared.slider', files: [images[2].id, images[0].id, images[1].id] }],
    });

    expect(await migrateSliderItems(strapi)).toBeGreaterThanOrEqual(1);
    expect(await migrateSliderItems(strapi)).toBe(0);

    const found = await strapi.documents(ARTICLE_UID).findOne({
      documentId: draft.documentId,
      populate: {
        blocks: {
          on: {
            'shared.slider': { populate: { files: true, items: { populate: ['file', 'credit'] } } },
          },
        },
      },
    });
    const [slider] = found.blocks;
    const expected = ['/uploads/laguna.png', '/uploads/sumapaz.png', '/uploads/frailejon.png'];
    expect(slider.items.map((item) => item.file.url)).toEqual(expected);
    expect(slider.items.map((item) => item.caption ?? null)).toEqual([null, null, null]);
    expect(slider.items.map((item) => item.credit ?? null)).toEqual([null, null, null]);
    expect(slider.files.map((file) => file.url)).toEqual(expected);
  });

  it('leaves sliders that already have items alone', async () => {
    const draft = await create({
      title: 'Both fields',
      blocks: [
        {
          __component: 'shared.slider',
          files: [images[0].id, images[1].id],
          items: [{ file: images[2].id }],
        },
      ],
    });

    await migrateSliderItems(strapi);

    const found = await strapi.documents(ARTICLE_UID).findOne({
      documentId: draft.documentId,
      populate: {
        blocks: { on: { 'shared.slider': { populate: { items: { populate: ['file'] } } } } },
      },
    });
    expect(found.blocks[0].items.map((item) => item.file.url)).toEqual(['/uploads/laguna.png']);
  });

  it('marks the legacy slider files as obsolete in the admin', async () => {
    const components = strapi.plugin('content-manager').service('components');
    const { metadatas } = await components.findConfiguration(
      components.findComponent('shared.slider')
    );
    expect(metadatas.files.edit.description).toMatch(/Obsoleto/);
  });
});
