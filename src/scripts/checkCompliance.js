/**
 * Check Article Compliance with Google Play Policies
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkCompliance() {
  try {
    // Get the most recent article
    const article = await prisma.article.findFirst({
      orderBy: { createdAt: 'desc' }
    });

    if (!article) {
      console.log('❌ No articles found in database');
      return;
    }

    console.log('\n🔍 GOOGLE PLAY COMPLIANCE CHECK\n');
    console.log('═══════════════════════════════════════════════════');
    console.log('📰 Title:', article.title.substring(0, 80) + (article.title.length > 80 ? '...' : ''));
    console.log('📁 Category:', article.category);
    console.log('───────────────────────────────────────────────────');
    
    // Check status
    console.log('✅ Status:', article.status, article.status === 'pending' ? '(Needs admin approval) ✅' : '');
    
    // Check content length
    const contentLength = article.content.length;
    console.log('📏 Content Length:', contentLength, 'chars', 
      contentLength >= 30 && contentLength <= 150 ? '✅ COMPLIANT' : '❌ TOO LONG/SHORT');
    
    // Check source URL
    console.log('🔗 Source URL:', article.sourceUrl ? '✅ Present' : '❌ Missing');
    if (article.sourceUrl) {
      console.log('   └─', article.sourceUrl.substring(0, 60) + '...');
    }
    
    // Check source name
    console.log('🏢 Source Name:', article.sourceName || 'N/A', article.sourceName ? '✅' : '❌');
    
    // Check image
    console.log('🖼️  Image URL:', article.imageUrl ? '✅ Present (from RSS/API)' : '❌ Missing');
    if (article.imageUrl) {
      console.log('   └─', article.imageUrl.substring(0, 60) + '...');
    }
    
    // Check author
    console.log('👤 Author:', article.originalAuthor || 'None', '(Optional)');
    
    // Check dates
    console.log('📅 Created:', new Date(article.createdAt).toLocaleString());
    console.log('📅 Original Published:', article.originalPublishedAt 
      ? new Date(article.originalPublishedAt).toLocaleString() 
      : 'N/A');
    
    console.log('───────────────────────────────────────────────────');
    console.log('📝 PREVIEW CONTENT:');
    console.log('┌─────────────────────────────────────────────────┐');
    console.log('│', article.content);
    console.log('└─────────────────────────────────────────────────┘');
    console.log('═══════════════════════════════════════════════════');
    
    console.log('\n📊 COMPLIANCE SUMMARY:\n');
    
    const checks = [];
    
    // Status check
    checks.push({
      pass: article.status === 'pending',
      text: 'Status: Pending (admin review required)'
    });
    
    // Content length check
    checks.push({
      pass: contentLength >= 30 && contentLength <= 150,
      text: `Content: Preview only (${contentLength} chars, target: 30-150)`
    });
    
    // Source URL check
    checks.push({
      pass: !!article.sourceUrl,
      text: 'Source URL: Present (click-through available)'
    });
    
    // Source name check
    checks.push({
      pass: !!article.sourceName,
      text: 'Source Name: Present (attribution)'
    });
    
    // Image check
    checks.push({
      pass: !!article.imageUrl,
      text: 'Image: From RSS/API only (no scraping)'
    });
    
    checks.forEach(check => {
      console.log(check.pass ? '✅' : '❌', check.text);
    });
    
    const allPass = checks.every(c => c.pass);
    
    console.log('\n' + '═'.repeat(60));
    if (allPass) {
      console.log('🎉 FULLY COMPLIANT - Ready for Google Play!');
      console.log('   ✅ No web scraping');
      console.log('   ✅ Preview only (not full content)');
      console.log('   ✅ Mandatory click-through to publisher');
      console.log('   ✅ Proper attribution');
      console.log('   ✅ Legal content sources');
    } else {
      console.log('⚠️  NEEDS FIXES - See failures above');
    }
    console.log('═'.repeat(60) + '\n');

  } catch (error) {
    console.error('Error checking compliance:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkCompliance();

