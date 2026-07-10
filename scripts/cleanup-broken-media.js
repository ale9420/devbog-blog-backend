const fs = require('fs');
const path = require('path');

async function cleanupBrokenMedia() {
  const { createStrapi, compileStrapi } = require('@strapi/strapi');

  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();

  try {
    console.log('Fetching all media files...');
    const files = await app.documents('plugin::upload.file').findMany();

    console.log(`Found ${files.length} media files.`);

    let valid = 0;
    let broken = 0;
    const brokenFiles = [];

    for (const file of files) {
      const filePath = path.join('/app/public/uploads', file.hash + file.ext);

      if (!fs.existsSync(filePath)) {
        broken++;
        brokenFiles.push(file);
        console.warn(`  ✗ Missing: ${file.name} (${file.hash}${file.ext})`);
      } else {
        valid++;
      }
    }

    console.log('\n=== Summary ===');
    console.log(`Valid files: ${valid}`);
    console.log(`Broken files: ${broken}`);

    if (brokenFiles.length === 0) {
      console.log('\nNo broken files found. Exiting.');
      return;
    }

    console.log('\nDeleting broken media entries...');

    for (const file of brokenFiles) {
      try {
        await app.documents('plugin::upload.file').delete({
          documentId: file.documentId,
        });
        console.log(`  ✓ Deleted: ${file.name}`);
      } catch (error) {
        console.error(`   Error deleting ${file.name}:`, error.message);
      }
    }

    console.log('\n=== Cleanup Complete ===');
    console.log(`Deleted ${broken} broken media entries.`);
    console.log('Please re-upload these images from your local files.');
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  } finally {
    await app.destroy();
    process.exit(0);
  }
}

cleanupBrokenMedia().catch((error) => {
  console.error(error);
  process.exit(1);
});
