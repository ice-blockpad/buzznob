// Request deduplication to prevent multiple simultaneous calls
const pendingRequests = new Map();

const deduplicateRequest = (key, requestFn) => {
  if (pendingRequests.has(key)) {
    return pendingRequests.get(key);
  }

  const promise = requestFn().finally(() => {
    pendingRequests.delete(key);
  });

  pendingRequests.set(key, promise);
  return promise;
};

// Clear pending requests for a specific key (useful when data changes)
const clearCache = (key) => {
  if (pendingRequests.has(key)) {
    pendingRequests.delete(key);
  }
};

// Clear all pending requests matching a pattern
const clearCachePattern = (pattern) => {
  const keysToDelete = [];
  for (const key of pendingRequests.keys()) {
    if (key.includes(pattern)) {
      keysToDelete.push(key);
    }
  }
  keysToDelete.forEach(key => pendingRequests.delete(key));
};

module.exports = { deduplicateRequest, clearCache, clearCachePattern };
