'use strict';

const request = require('supertest');
const { setupStrapi, cleanupStrapi } = require('./strapi');
const { setPublicPermissions } = require('./helpers/permissions');
const { citedKeys, citationOrder } = require('../src/api/article/utils/citations');
const { markdownToPlainText } = require('../src/api/article/utils/plain-text');

const ARTICLE_UID = 'api::article.article';

const richText = (body) => ({ __component: 'shared.rich-text', body });
const quote = (body) => ({ __component: 'shared.quote', body });

const reference = (key, extra = {}) => ({
  key,
  type: 'journal',
  authors: 'Lewis, P., Perez, E., et al.',
  year: '2020',
  title: `Source ${key}`,
  ...extra,
});

describe('Citation syntax', () => {
  it('reads single and grouped citations in order', () => {
    expect(citedKeys('Uno.[@ji-2023] Dos [@lewis-2020; @gao-2023] y otra vez [@ji-2023].')).toEqual(
      ['ji-2023', 'lewis-2020', 'gao-2023', 'ji-2023']
    );
  });

  it('ignores code, links whose text starts with @, and malformed keys', () => {
    const markdown = [
      'Escribe `[@clave]` en el texto.',
      '```md',
      'Así se cita: [@dentro-del-bloque]',
      '```',
      'Sigue a [@devbog](https://example.com) o [@Mayúsculas].',
    ].join('\n');
    expect(citedKeys(markdown)).toEqual([]);
  });

  it('numbers keys by first appearance across rich-text and quote blocks', () => {
    const blocks = [
      richText('Primero [@b].'),
      { __component: 'shared.media', file: null },
      quote('Luego [@a; @b].'),
      richText('Y [@c].'),
    ];
    expect(citationOrder(blocks)).toEqual(['b', 'a', 'c']);
  });

  it('drops citation markers from the plain text', () => {
    expect(
      markdownToPlainText('Inventan con confianza [@ji-2023]. RAG conecta fuentes.[@a; @b]')
    ).toBe('Inventan con confianza. RAG conecta fuentes.');
  });
});

describe('Article references', () => {
  const create = (data) => strapi.documents(ARTICLE_UID).create({ data });

  beforeAll(async () => {
    await setupStrapi();
    await setPublicPermissions('article', ['find', 'findOne']);
    const locales = strapi.plugin('i18n').service('locales');
    if (!(await locales.findByCode('es'))) {
      await locales.create({ code: 'es', name: 'Spanish (es)' });
    }
  });

  afterAll(async () => {
    await cleanupStrapi();
  });

  it('returns the references through the public API with populate', async () => {
    const draft = await create({
      title: 'With sources',
      slug: 'with-sources',
      blocks: [richText('RAG [@lewis-2020] y DPR [@karpukhin-2020].')],
      references: [
        reference('lewis-2020', {
          type: 'conference',
          container: 'Advances in Neural Information Processing Systems',
          volume: '33',
          venueLabel: 'NeurIPS 2020',
          url: 'https://arxiv.org/abs/2005.11401',
          accessedAt: '2026-09-11',
        }),
        reference('karpukhin-2020', { doi: '10.18653/v1/2020.emnlp-main.550' }),
        reference('uncited-2024', { type: 'web' }),
      ],
    });
    await strapi.documents(ARTICLE_UID).publish({ documentId: draft.documentId });

    const res = await request(strapi.server.httpServer)
      .get('/api/articles')
      .query({ filters: { slug: { $eq: 'with-sources' } }, populate: 'references' })
      .expect(200);

    const [article] = res.body.data;
    expect(article.references.map((entry) => entry.key)).toEqual([
      'lewis-2020',
      'karpukhin-2020',
      'uncited-2024',
    ]);
    expect(article.references[0]).toMatchObject({
      type: 'conference',
      authors: 'Lewis, P., Perez, E., et al.',
      year: '2020',
      container: 'Advances in Neural Information Processing Systems',
      volume: '33',
      venueLabel: 'NeurIPS 2020',
      url: 'https://arxiv.org/abs/2005.11401',
      accessedAt: '2026-09-11',
    });
    expect(article.references[1].doi).toBe('10.18653/v1/2020.emnlp-main.550');
  });

  it('rejects a citation without a reference, naming the key', async () => {
    await expect(
      create({ title: 'Missing source', blocks: [richText('Dato [@no-existe].')] })
    ).rejects.toThrow(/\[@no-existe\]/);
  });

  it('rejects duplicate reference keys', async () => {
    await expect(
      create({ title: 'Twice', references: [reference('same'), reference('same')] })
    ).rejects.toThrow(/Duplicate reference key: same/);
  });

  it('rejects a malformed DOI, URL or key', async () => {
    for (const bad of [
      reference('bad-doi', { doi: 'https://doi.org/10.1145/3571730' }),
      reference('bad-url', { url: 'arxiv.org/abs/2005.11401' }),
      reference('Bad Key'),
    ]) {
      await expect(create({ title: 'Bad source', references: [bad] })).rejects.toThrow(/must be/);
    }
  });

  it('checks an update of the body against the stored references', async () => {
    const draft = await create({
      title: 'Edited later',
      blocks: [richText('Sin citas.')],
      references: [reference('ji-2023')],
    });

    await expect(
      strapi.documents(ARTICLE_UID).update({
        documentId: draft.documentId,
        data: { blocks: [richText('Ahora cita [@ji-2023].')] },
      })
    ).resolves.toBeTruthy();

    await expect(
      strapi.documents(ARTICLE_UID).update({
        documentId: draft.documentId,
        data: { blocks: [richText('Y ahora [@otra].')] },
      })
    ).rejects.toThrow(/\[@otra\]/);
  });

  it('shares references across locales and checks every locale when they change', async () => {
    const draft = await create({
      title: 'Bilingual',
      blocks: [richText('English body [@gao-2023].')],
      references: [reference('gao-2023'), reference('ji-2023')],
    });

    const spanish = await strapi.documents(ARTICLE_UID).update({
      documentId: draft.documentId,
      locale: 'es',
      data: { title: 'Bilingüe', blocks: [richText('Cuerpo en español [@ji-2023].')] },
      populate: ['references'],
    });
    expect(spanish.references.map((entry) => entry.key)).toEqual(['gao-2023', 'ji-2023']);

    // Removing a key still cited by the Spanish body fails even from the English side.
    await expect(
      strapi.documents(ARTICLE_UID).update({
        documentId: draft.documentId,
        data: { references: [reference('gao-2023')] },
      })
    ).rejects.toThrow(/\[@ji-2023\]/);
  });

  it('stores the plain text without citation markers', async () => {
    const draft = await create({
      title: 'Plain',
      blocks: [richText('Alucinaciones [@ji-2023].')],
      references: [reference('ji-2023')],
    });
    const row = await strapi.db.query(ARTICLE_UID).findOne({
      where: { documentId: draft.documentId, publishedAt: null },
    });
    expect(row.plainText).toBe('Alucinaciones.');
  });

  it('keeps articles without references working', async () => {
    const draft = await create({ title: 'No sources', blocks: [richText('Solo texto.')] });
    const found = await strapi.documents(ARTICLE_UID).findOne({
      documentId: draft.documentId,
      populate: ['references'],
    });
    expect(found.references).toEqual([]);
  });

  it('describes the field in the admin', async () => {
    const { metadatas } = await strapi
      .plugin('content-manager')
      .service('content-types')
      .findConfiguration({ uid: ARTICLE_UID });

    expect(metadatas.references.edit.description).toMatch(/\[@clave\]/);
  });
});
