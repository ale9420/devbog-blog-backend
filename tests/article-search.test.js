'use strict';

const request = require('supertest');
const { setupStrapi, cleanupStrapi } = require('./strapi');
const {
  markdownToPlainText,
  blocksToPlainText,
  snippetAround,
} = require('../src/api/article/utils/plain-text');
const { backfillArticlePlainText } = require('../src/migrations/article-plain-text');

const ARTICLE_UID = 'api::article.article';

const richText = (body) => ({ __component: 'shared.rich-text', body });

describe('Article plain text and content search', () => {
  const search = (query) =>
    request(strapi.server.httpServer).get('/api/articles/search').query(query);

  async function publish(data) {
    const draft = await strapi.documents(ARTICLE_UID).create({ data });
    await strapi.documents(ARTICLE_UID).publish({ documentId: draft.documentId });
    return draft;
  }

  async function plainTextOf(documentId, status) {
    const row = await strapi.db.query(ARTICLE_UID).findOne({
      where: { documentId, publishedAt: status === 'draft' ? null : { $notNull: true } },
    });
    return row.plainText;
  }

  beforeAll(async () => {
    await setupStrapi();
  });

  afterAll(async () => {
    await cleanupStrapi();
  });

  describe('markdownToPlainText', () => {
    it('drops Markdown and HTML syntax but keeps the words and the code', () => {
      const markdown = [
        '## Un **título** con `código`',
        '',
        '> Una cita con [un enlace](https://example.com) y ![la imagen](a.png)',
        '',
        '- [x] tarea hecha',
        '1. primer paso',
        '',
        '```bash',
        'ollama run llama3',
        '```',
        '',
        '| Col | Otra |',
        '| --- | ---- |',
        '| a | b |',
        '',
        '<details>oculto</details> y my_snake_case _énfasis_',
      ].join('\n');

      expect(markdownToPlainText(markdown)).toBe(
        [
          'Un título con código',
          '',
          'Una cita con un enlace y la imagen',
          '',
          'tarea hecha',
          'primer paso',
          '',
          'ollama run llama3',
          '',
          'Col Otra',
          'a b',
          '',
          'oculto y my_snake_case énfasis',
        ].join('\n')
      );
    });

    it('reads rich-text and quote blocks in order and ignores media', () => {
      expect(
        blocksToPlainText([
          richText('Primero'),
          { __component: 'shared.media', file: 1 },
          { __component: 'shared.quote', title: 'Autora', body: 'Cita *breve*' },
        ])
      ).toBe('Primero\n\nAutora\n\nCita breve');
      expect(blocksToPlainText(undefined)).toBe('');
    });

    it('snippetAround cuts at word boundaries around the first match', () => {
      const text = `${'palabra '.repeat(30)}Soberanía digital ${'resto '.repeat(30)}`;
      const snippet = snippetAround(text, 'soberanía', 20);
      expect(snippet.startsWith('…')).toBe(true);
      expect(snippet.endsWith('…')).toBe(true);
      expect(snippet).toContain('Soberanía digital');
      expect(snippetAround('nada', 'soberanía')).toBeNull();
    });
  });

  describe('plainText field', () => {
    it('is computed on create, copied on publish and recomputed on update', async () => {
      const article = await publish({
        title: 'Plain text lifecycle',
        slug: 'plain-text-lifecycle',
        blocks: [richText('Hablemos de **Kubernetes**')],
      });
      expect(await plainTextOf(article.documentId, 'draft')).toBe('Hablemos de Kubernetes');
      expect(await plainTextOf(article.documentId, 'published')).toBe('Hablemos de Kubernetes');

      await strapi.documents(ARTICLE_UID).update({
        documentId: article.documentId,
        data: { blocks: [richText('Ahora de Podman')] },
      });
      expect(await plainTextOf(article.documentId, 'draft')).toBe('Ahora de Podman');
      expect(await plainTextOf(article.documentId, 'published')).toBe('Hablemos de Kubernetes');

      await strapi.documents(ARTICLE_UID).update({
        documentId: article.documentId,
        data: { title: 'Plain text lifecycle, renamed' },
      });
      expect(await plainTextOf(article.documentId, 'draft')).toBe('Ahora de Podman');
    });

    it('is not exposed by the public articles API', async () => {
      const article = await publish({
        title: 'Private plain text',
        slug: 'private-plain-text',
        blocks: [richText('secreto')],
      });
      const res = await request(strapi.server.httpServer)
        .get(`/api/articles/${article.documentId}`)
        .set('Authorization', '');
      expect(res.body?.data?.plainText).toBeUndefined();
    });

    it('is backfilled for rows saved before the field existed', async () => {
      const article = await publish({
        title: 'Legacy article',
        slug: 'legacy-article',
        blocks: [richText('Texto heredado')],
      });
      await strapi.db
        .query(ARTICLE_UID)
        .updateMany({ where: { documentId: article.documentId }, data: { plainText: null } });

      expect(await backfillArticlePlainText(strapi)).toBe(2);
      expect(await plainTextOf(article.documentId, 'published')).toBe('Texto heredado');
      expect(await backfillArticlePlainText(strapi)).toBe(0);
    });
  });

  describe('GET /api/articles/search', () => {
    beforeAll(async () => {
      await publish({
        title: 'Autoalojamiento en casa',
        slug: 'autoalojamiento-en-casa',
        description: 'Un servidor pequeño para tus datos.',
        blocks: [richText('Instalamos **Nextcloud** sobre una Raspberry Pi.')],
      });
      await strapi.documents(ARTICLE_UID).create({
        data: {
          title: 'Borrador sobre Nextcloud',
          slug: 'borrador-nextcloud',
          blocks: [richText('Nextcloud sin publicar')],
        },
      });
    });

    it('searches only titles by default', async () => {
      const res = await search({ q: 'nextcloud' }).expect(200);
      expect(res.body.data).toEqual([]);

      const byTitle = await search({ q: 'autoaloja' }).expect(200);
      expect(byTitle.body.data).toHaveLength(1);
      expect(byTitle.body.data[0]).toMatchObject({
        slug: 'autoalojamiento-en-casa',
        matchedIn: 'title',
      });
    });

    it('finds a word that only appears in the body when content is on', async () => {
      const res = await search({ q: 'NEXTCLOUD', content: '1' }).expect(200);

      expect(res.body.data.map((article) => article.slug)).toEqual(['autoalojamiento-en-casa']);
      expect(res.body.data[0]).toMatchObject({
        matchedIn: 'content',
        snippet: 'Instalamos Nextcloud sobre una Raspberry Pi.',
      });
      expect(res.body.data[0].plainText).toBeUndefined();
    });

    it('matches the description when content is on', async () => {
      const res = await search({ q: 'servidor pequeño', content: 'true' }).expect(200);
      expect(res.body.data[0]).toMatchObject({ matchedIn: 'description' });
    });

    it('treats % and _ in the query as literal characters, not wildcards', async () => {
      const res = await search({ q: 'Next%loud', content: '1' }).expect(200);
      expect(res.body.data).toEqual([]);
      const underscore = await search({ q: 'Nextclo_d', content: '1' }).expect(200);
      expect(underscore.body.data).toEqual([]);
    });

    it('filters by locale', async () => {
      const res = await search({ q: 'nextcloud', content: '1', locale: 'fr' }).expect(200);
      expect(res.body.data).toEqual([]);
    });

    it('rejects queries shorter than three characters', async () => {
      await search({ q: ' ab ' }).expect(400);
    });
  });
});
