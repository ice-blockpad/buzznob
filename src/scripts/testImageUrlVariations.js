/**
 * Test Image URL Variations
 * Tries to find larger versions of thumbnail images
 */

const axios = require('axios');

async function testImageUrlVariations(thumbnailUrl) {
  console.log('\n🔍 Testing Image URL Variations');
  console.log('='.repeat(80));
  console.log(`Original URL: ${thumbnailUrl}\n`);
  
  // BBC iChef URL patterns
  // Thumbnail: /ace/standard/240/...
  // Possible larger sizes: 480, 640, 800, 1024, 1280, 1920
  
  const variations = [];
  
  // Try different sizes
  const sizes = [480, 640, 800, 1024, 1280, 1920];
  
  for (const size of sizes) {
    const largerUrl = thumbnailUrl.replace('/standard/240/', `/standard/${size}/`);
    variations.push({
      size,
      url: largerUrl,
      original: thumbnailUrl
    });
  }
  
  // Also try removing size restriction entirely
  const noSizeUrl = thumbnailUrl.replace('/standard/240/', '/ace/');
  variations.push({
    size: 'original',
    url: noSizeUrl,
    original: thumbnailUrl
  });
  
  console.log('Testing variations:\n');
  
  for (const variation of variations) {
    try {
      const response = await axios.head(variation.url, {
        timeout: 5000,
        maxRedirects: 5,
        validateStatus: () => true
      });
      
      const sizeKB = response.headers['content-length'] 
        ? (parseInt(response.headers['content-length']) / 1024).toFixed(2)
        : 'unknown';
      
      if (response.status === 200) {
        console.log(`✅ ${variation.size}px: ${variation.url}`);
        console.log(`   Status: ${response.status}`);
        console.log(`   Size: ${sizeKB} KB`);
        console.log(`   Content-Type: ${response.headers['content-type'] || 'unknown'}\n`);
      } else {
        console.log(`❌ ${variation.size}px: Status ${response.status}\n`);
      }
    } catch (error) {
      console.log(`❌ ${variation.size}px: ${error.message}\n`);
    }
  }
}

// Test with the BBC thumbnail we found
const thumbnailUrl = 'https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/61bd/live/58caa050-d1dc-11f0-9267-ab26a8fe8cc2.jpg';

testImageUrlVariations(thumbnailUrl)
  .then(() => {
    console.log('\n✅ Test complete');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  });

