'use strict';

const { parseFrontendArticlePath } = require('../src/utils/frontend-url');

describe('parseFrontendArticlePath', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it('reads the slug and the locale, which defaults to the unprefixed one', () => {
    expect(parseFrontendArticlePath('/blog/linux-hardening')).toEqual({
      slug: 'linux-hardening',
      locale: 'en',
    });
    expect(parseFrontendArticlePath('/es/blog/endurecer-linux/')).toEqual({
      slug: 'endurecer-linux',
      locale: 'es',
    });
    expect(parseFrontendArticlePath('/blog/caf%C3%A9')).toEqual({ slug: 'café', locale: 'en' });
  });

  it('ignores paths that are not an article', () => {
    for (const path of ['/', '/blog', '/es/blog', '/about', '/blog/a/b', '/blog/%E0%A4%A']) {
      expect(parseFrontendArticlePath(path)).toBeNull();
    }
  });

  it('follows FRONTEND_ARTICLE_PATH, FRONTEND_DEFAULT_LOCALE and the base path of FRONTEND_URL', () => {
    process.env.FRONTEND_URL = 'https://example.com/site/';
    process.env.FRONTEND_ARTICLE_PATH = '/posts/{slug}.html';
    process.env.FRONTEND_DEFAULT_LOCALE = 'es';
    expect(parseFrontendArticlePath('/site/posts/hola.html')).toEqual({
      slug: 'hola',
      locale: 'es',
    });
    expect(parseFrontendArticlePath('/site/en/posts/hello.html')).toEqual({
      slug: 'hello',
      locale: 'en',
    });
    expect(parseFrontendArticlePath('/posts/hola.html')).toBeNull();
  });
});
