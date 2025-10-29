/**
 * Cache utility for Chrome extension
 * Provides TTL-based caching using chrome.storage.local
 */

class Cache {
    constructor() {
        this.prefix = 'cache_';
    }

    /**
     * Generate a cache key with prefix
     * @param {string} key - Base cache key
     * @returns {string} - Prefixed cache key
     */
    getCacheKey(key) {
        return `${this.prefix}${key}`;
    }

    /**
     * Set a value in cache with TTL
     * @param {string} key - Cache key
     * @param {any} value - Value to cache
     * @param {number} ttlMs - Time to live in milliseconds
     * @returns {Promise<void>}
     */
    async set(key, value, ttlMs) {
        const cacheKey = this.getCacheKey(key);
        const expiresAt = Date.now() + ttlMs;

        const cacheEntry = {
            value,
            expiresAt,
            cachedAt: Date.now()
        };

        return new Promise((resolve) => {
            chrome.storage.local.set({ [cacheKey]: cacheEntry }, () => {
                resolve();
            });
        });
    }

    /**
     * Get a value from cache
     * @param {string} key - Cache key
     * @returns {Promise<any|null>} - Cached value or null if expired/not found
     */
    async get(key) {
        const cacheKey = this.getCacheKey(key);

        return new Promise((resolve) => {
            chrome.storage.local.get([cacheKey], (result) => {
                const cacheEntry = result[cacheKey];

                if (!cacheEntry) {
                    resolve(null);
                    return;
                }

                // Check if expired
                if (Date.now() > cacheEntry.expiresAt) {
                    // Clean up expired entry
                    chrome.storage.local.remove([cacheKey]);
                    resolve(null);
                    return;
                }

                resolve(cacheEntry.value);
            });
        });
    }

    /**
     * Check if a key exists and is not expired
     * @param {string} key - Cache key
     * @returns {Promise<boolean>}
     */
    async has(key) {
        const value = await this.get(key);
        return value !== null;
    }

    /**
     * Get cache metadata (expiration time, cached time) without returning the value
     * @param {string} key - Cache key
     * @returns {Promise<{expiresAt: number, cachedAt: number, timeUntilExpiry: number}|null>}
     */
    async getMetadata(key) {
        const cacheKey = this.getCacheKey(key);

        return new Promise((resolve) => {
            chrome.storage.local.get([cacheKey], (result) => {
                const cacheEntry = result[cacheKey];

                if (!cacheEntry) {
                    resolve(null);
                    return;
                }

                // Check if expired
                if (Date.now() > cacheEntry.expiresAt) {
                    resolve(null);
                    return;
                }

                resolve({
                    expiresAt: cacheEntry.expiresAt,
                    cachedAt: cacheEntry.cachedAt,
                    timeUntilExpiry: cacheEntry.expiresAt - Date.now()
                });
            });
        });
    }

    /**
     * Delete a specific cache entry
     * @param {string} key - Cache key
     * @returns {Promise<void>}
     */
    async delete(key) {
        const cacheKey = this.getCacheKey(key);
        return new Promise((resolve) => {
            chrome.storage.local.remove([cacheKey], () => {
                resolve();
            });
        });
    }

    /**
     * Clear all cache entries
     * @returns {Promise<void>}
     */
    async clear() {
        return new Promise((resolve) => {
            chrome.storage.local.get(null, (items) => {
                const cacheKeys = Object.keys(items).filter(key =>
                    key.startsWith(this.prefix)
                );

                if (cacheKeys.length > 0) {
                    chrome.storage.local.remove(cacheKeys, () => {
                        resolve();
                    });
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * Clean up expired cache entries
     * @returns {Promise<number>} - Number of entries removed
     */
    async cleanExpired() {
        return new Promise((resolve) => {
            chrome.storage.local.get(null, (items) => {
                const now = Date.now();
                const expiredKeys = [];

                for (const [key, value] of Object.entries(items)) {
                    if (key.startsWith(this.prefix) && value.expiresAt && now > value.expiresAt) {
                        expiredKeys.push(key);
                    }
                }

                if (expiredKeys.length > 0) {
                    chrome.storage.local.remove(expiredKeys, () => {
                        resolve(expiredKeys.length);
                    });
                } else {
                    resolve(0);
                }
            });
        });
    }
}

// TTL constants (in milliseconds)
export const TTL = {
    PROFILE_PIC: 24 * 60 * 60 * 1000,      // 24 hours
    USER_STATS: 2 * 60 * 60 * 1000,        // 2 hours
    SUBMISSIONS: 10 * 60 * 1000,            // 10 minutes
    DAILY_LEADERBOARD: 5 * 60 * 1000        // 5 minutes
};

export default new Cache();
