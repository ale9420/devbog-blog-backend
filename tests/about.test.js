'use strict';

const qs = require('qs');
const request = require('supertest');
const { setupStrapi, cleanupStrapi } = require('./strapi');
const { setPublicPermissions } = require('./helpers/permissions');

const ABOUT = 'api::about.about';

const POPULATE = {
  blocks: {
    on: {
      'about.profile': { populate: '*' },
      'about.statement': { populate: '*' },
      'about.topics': { populate: '*' },
      'about.projects': { populate: { projects: { populate: '*' } } },
      'about.principles': { populate: '*' },
      'about.open-source': { populate: '*' },
      'about.contact': { populate: '*' },
    },
  },
};

const BLOCKS = [
  {
    __component: 'about.profile',
    eyebrow: 'Acerca de · ficha de campo',
    title: 'Hola, soy Alejandro.',
    lead: 'Escribo sobre desarrollo de software, open source y tecnología.',
    facts: [
      { label: 'Nombre', value: 'Alejandro Ramírez' },
      { label: 'Canto', value: '@devbog@api.bogdev.com.co', mono: true },
    ],
    links: [
      { label: 'Leer el blog', url: '/blog', variant: 'primary' },
      { label: 'Ver proyectos', url: '#proyectos', variant: 'secondary' },
    ],
    plateLabel: 'LÁM. 01',
    plateCoordinates: '4.61°N 74.08°W',
    caption: 'Copetón · Zonotrichia capensis',
  },
  {
    __component: 'about.statement',
    eyebrow: 'Quién escribe',
    statement: 'Soy un desarrollador de software colombiano.',
    body: 'Este blog es mi rincón en internet.',
  },
  {
    __component: 'about.topics',
    eyebrow: 'Lo que escribo',
    title: 'Cinco temas, cinco aves de la sabana',
    topics: [{ category: 'privacidad', title: 'Privacidad', description: 'Soberanía digital.' }],
    footnoteLabel: 'También, en cada tema:',
    footnote: 'Tutoriales prácticos',
  },
  {
    __component: 'about.projects',
    anchor: 'proyectos',
    title: 'Lo que he construido',
    projects: [
      {
        eyebrow: 'Proyecto destacado',
        meta: 'Backend · 2026',
        title: 'BogDev en el fediverso',
        featured: true,
        visual: 'fediverse',
        facts: [{ label: 'Stack', value: 'Fedify · Strapi 5' }],
        stack: [{ name: 'Fedify' }],
        links: [
          {
            label: 'Ver repositorio',
            url: 'https://github.com/ale9420/devbog-blog-backend',
            variant: 'primary',
          },
        ],
      },
    ],
  },
  {
    __component: 'about.principles',
    title: 'Cinco principios',
    principles: [{ title: 'Software libre', text: 'Una filosofía de transparencia.' }],
  },
  {
    __component: 'about.open-source',
    text: 'Este blog está construido con herramientas libres.',
    code: '$ git clone https://github.com/ale9420/devbog-blog-front',
    guideTitle: 'Cómo moverte por aquí',
    guide: [{ text: 'Usa la [búsqueda](#search).' }],
  },
  {
    __component: 'about.contact',
    title: 'Hablemos.',
    fediverseHandle: '@devbog@api.bogdev.com.co',
    fediverseLink: { label: 'Cómo seguirlo', url: '/#fediverso', variant: 'text' },
    extraLink: {
      label: 'Invitarme un café',
      url: 'https://www.buymeacoffee.com/ale9420',
      variant: 'text',
    },
    socials: [{ network: 'GitHub', handle: '@ale9420', url: 'https://github.com/ale9420' }],
  },
];

describe('About field card', () => {
  beforeAll(async () => {
    await setupStrapi();
    await setPublicPermissions('about', ['find']);
    await strapi.documents(ABOUT).create({ data: { title: 'Acerca de', blocks: BLOCKS } });
  });

  afterAll(async () => {
    await cleanupStrapi();
  });

  it('exposes every field card block with its nested components', async () => {
    const res = await request(strapi.server.httpServer)
      .get(`/api/about?${qs.stringify({ populate: POPULATE })}`)
      .expect(200);

    const blocks = res.body.data.blocks;
    expect(blocks.map((block) => block.__component)).toEqual(
      BLOCKS.map((block) => block.__component)
    );

    const [profile, , topics, projects, principles, openSource, contact] = blocks;
    expect(profile.facts).toEqual([
      expect.objectContaining({ label: 'Nombre', value: 'Alejandro Ramírez', mono: false }),
      expect.objectContaining({ label: 'Canto', mono: true }),
    ]);
    expect(profile.links.map((link) => link.variant)).toEqual(['primary', 'secondary']);
    expect(topics.topics[0]).toEqual(
      expect.objectContaining({ category: 'privacidad', title: 'Privacidad' })
    );

    const [featured] = projects.projects;
    expect(featured).toEqual(expect.objectContaining({ featured: true, visual: 'fediverse' }));
    expect(featured.facts[0]).toEqual(expect.objectContaining({ label: 'Stack' }));
    expect(featured.stack[0]).toEqual(expect.objectContaining({ name: 'Fedify' }));
    expect(featured.links[0]).toEqual(expect.objectContaining({ variant: 'primary' }));

    expect(principles.principles[0]).toEqual(expect.objectContaining({ title: 'Software libre' }));
    expect(openSource.guide[0].text).toBe('Usa la [búsqueda](#search).');
    expect(contact.fediverseLink).toEqual(expect.objectContaining({ url: '/#fediverso' }));
    expect(contact.socials[0]).toEqual(expect.objectContaining({ network: 'GitHub' }));
  });

  it('rejects a topic outside the five categories', async () => {
    await expect(
      strapi.documents(ABOUT).update({
        documentId: (await strapi.documents(ABOUT).findFirst()).documentId,
        data: {
          blocks: [{ __component: 'about.topics', topics: [{ category: 'web', title: 'Web' }] }],
        },
      })
    ).rejects.toThrow();
  });
});
