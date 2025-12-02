const { prisma } = require('../config/database');

/**
 * Helper functions to fetch article data for cache refresh
 * Used in write-through cache strategy
 */

/**
 * Fetch trending articles from database
 * @param {number} limit - Number of articles to fetch
 * @returns {Promise<Array>} - Array of articles with read counts
 */
async function fetchTrendingArticles(limit) {
  const articles = await prisma.article.findMany({
    where: {
      isFeatured: true,
      status: 'published'
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      title: true,
      content: true,
      category: true,
      sourceUrl: true,
      sourceName: true,
      pointsValue: true,
      isFeatured: true,
      manualReadCount: true,
      imageUrl: true,
      imageData: true,
      imageType: true,
      createdAt: true,
      author: {
        select: {
          id: true,
          username: true,
          displayName: true,
          role: true
        }
      }
    }
  });

  // Get read counts (using ReadArticle for historical counts)
  const articleIds = articles.map(a => a.id);
  const readCountMap = new Map();
  
  if (articleIds.length > 0) {
    const readCounts = await prisma.readArticle.groupBy({
      by: ['articleId'],
      where: {
        articleId: { in: articleIds }
      },
      _count: {
        articleId: true
      }
    });

    readCounts.forEach(item => {
      readCountMap.set(item.articleId, item._count.articleId);
    });
  }

  return articles.map(article => {
    const actualCount = readCountMap.get(article.id) || 0;
    const readCount = article.manualReadCount !== null ? article.manualReadCount : actualCount;
    return {
      ...article,
      readCount
    };
  });
}

/**
 * Fetch featured articles from database
 * @param {number} limit - Number of articles to fetch
 * @returns {Promise<Array>} - Array of articles with read counts
 */
async function fetchFeaturedArticles(limit) {
  const articles = await prisma.article.findMany({
    where: {
      isFeaturedArticle: true,
      status: 'published'
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      title: true,
      content: true,
      category: true,
      sourceUrl: true,
      sourceName: true,
      pointsValue: true,
      isFeatured: true,
      isFeaturedArticle: true,
      manualReadCount: true,
      imageUrl: true,
      imageData: true,
      imageType: true,
      createdAt: true,
      author: {
        select: {
          id: true,
          username: true,
          displayName: true,
          role: true
        }
      }
    }
  });

  // Get read counts (using ReadArticle for historical counts)
  const articleIds = articles.map(a => a.id);
  const readCountMap = new Map();
  
  if (articleIds.length > 0) {
    const readCounts = await prisma.readArticle.groupBy({
      by: ['articleId'],
      where: {
        articleId: { in: articleIds }
      },
      _count: {
        articleId: true
      }
    });

    readCounts.forEach(item => {
      readCountMap.set(item.articleId, item._count.articleId);
    });
  }

  return articles.map(article => {
    const actualCount = readCountMap.get(article.id) || 0;
    const readCount = article.manualReadCount !== null ? article.manualReadCount : actualCount;
    return {
      ...article,
      readCount
    };
  });
}

module.exports = {
  fetchTrendingArticles,
  fetchFeaturedArticles
};

