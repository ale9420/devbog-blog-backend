const fs = require('fs');
const path = require('path');

async function regenerateThumbnails() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi');

  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();

  try {
    console.log('Fetching all media files...');
    const files = await app.documents('plugin::upload.file').findMany();

    console.log(`Found ${files.length} media files.`);

    const uploadService = app.plugin('upload').service('upload');
    let processed = 0;
    let skipped = 0;
    let errors = 0;

    for (const file of files) {
      const filePath = path.join('/app/public/uploads', file.hash + file.ext);

      if (!fs.existsSync(filePath)) {
        console.warn(`️  Original file missing: ${file.name} (${file.hash}${file.ext}). Skipping.`);
        skipped++;
        continue;
      }

      try {
        console.log(`Processing: ${file.name}`);

        // Re-upload the file to regenerate thumbnails
        const fileData = {
          name: file.name,
          alternativeText: file.alternativeText || null,
          caption: file.caption || null,
        };

        await uploadService.upload({
          files: {
            path: filePath,
            name: file.hash + file.ext,
            type: file.mime,
            size: file.size,
          },
          data: {
            fileInfo: fileData,
          },
        });

        processed++;
        console.log(`  ✓ Thumbnails regenerated for ${file.name}`);
      } catch (error) {
        errors++;
        console.error(`   Error processing ${file.name}:`, error.message);
      }
    }

    console.log('\n=== Regeneration Complete ===');
    console.log(`Processed: ${processed}`);
    console.log(`Skipped (missing files): ${skipped}`);
    console.log(`Errors: ${errors}`);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  } finally {
    await app.destroy();
    process.exit(0);
  }
}

regenerateThumbnails().catch((error) => {
  console.error(error);
  process.exit(1);
});
