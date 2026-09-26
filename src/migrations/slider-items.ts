import type { Core } from '@strapi/strapi';

const SLIDER_UID = 'shared.slider';
const SLIDE_UID = 'shared.slide';
const BATCH_SIZE = 50;

interface SliderRow {
  id: number;
  files?: { id: number }[] | null;
  items?: { id: number }[] | null;
}

/**
 * Copies each slider's legacy `files` into `items`, one slide per image in
 * the same order, with no caption or credit. It writes the component rows
 * directly (drafts and published versions, articles and the about page), so
 * nothing gets republished. Idempotent: sliders that already have items are
 * skipped, and `files` is left as it was.
 */
export async function migrateSliderItems(strapi: Core.Strapi): Promise<number> {
  const sliders = strapi.db.query(SLIDER_UID);
  let migrated = 0;
  let lastId = 0;

  for (;;) {
    const rows = (await sliders.findMany({
      select: ['id'],
      where: { id: { $gt: lastId } },
      populate: { files: { select: ['id'] }, items: { select: ['id'] } },
      orderBy: { id: 'asc' },
      limit: BATCH_SIZE,
    })) as SliderRow[];
    if (rows.length === 0) return migrated;
    lastId = rows[rows.length - 1].id;

    for (const row of rows) {
      if ((row.items?.length ?? 0) > 0 || !row.files?.length) continue;

      const slides: { id: number }[] = [];
      for (const file of row.files) {
        slides.push(await strapi.db.query(SLIDE_UID).create({ data: { file: file.id } }));
      }
      await sliders.update({
        where: { id: row.id },
        data: {
          items: slides.map(({ id }) => ({
            id,
            __pivot: { field: 'items', component_type: SLIDE_UID },
          })),
        },
      });
      migrated += 1;
    }
  }
}
