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

module.exports = { deduplicateRequest };
