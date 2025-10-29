import cache from './cache.js';

/**
 * Formats milliseconds into a human-readable time string
 * @param {number} ms - Milliseconds
 * @returns {string} - Formatted time string
 */
function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (minutes > 60) {
        const hours = Math.floor(minutes / 60);
        const remainingMinutes = minutes % 60;
        if (hours > 24) {
            const days = Math.floor(hours / 24);
            const remainingHours = hours % 24;
            return remainingHours > 0
                ? `${days}d ${remainingHours}h`
                : `${days}d`;
        }
        return remainingMinutes > 0
            ? `${hours}h ${remainingMinutes}m`
            : `${hours}h`;
    }

    if (minutes > 0) {
        return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
    }

    return `${seconds}s`;
}

/**
 * Gets the shortest time until expiry from multiple cache keys
 * @param {string[]} cacheKeys - Array of cache keys to check
 * @returns {Promise<number|null>} - Milliseconds until expiry, or null if no cache
 */
async function getMinTimeUntilExpiry(cacheKeys) {
    const metadataPromises = cacheKeys.map(key => cache.getMetadata(key));
    const metadataResults = await Promise.all(metadataPromises);

    const validMetadata = metadataResults.filter(m => m !== null);

    if (validMetadata.length === 0) {
        return null;
    }

    const minTime = Math.min(...validMetadata.map(m => m.timeUntilExpiry));
    return minTime;
}

/**
 * Creates and manages an update timer display element
 * @param {string} containerId - ID of the container element
 * @param {string[]} cacheKeys - Array of cache keys to monitor
 * @returns {Object} - Object with update and destroy methods
 */
export function createUpdateTimer(containerId, cacheKeys) {
    const container = document.getElementById(containerId);
    if (!container) {
        console.error(`Container ${containerId} not found`);
        return { update: () => {}, destroy: () => {} };
    }

    // Create timer element
    let timerElement = container.querySelector('.update-timer');
    if (!timerElement) {
        timerElement = document.createElement('div');
        timerElement.className = 'update-timer';
        container.appendChild(timerElement);
    }

    let intervalId = null;

    async function updateDisplay() {
        const timeUntilExpiry = await getMinTimeUntilExpiry(cacheKeys);

        if (timeUntilExpiry === null) {
            timerElement.textContent = 'Updates on next open';
        } else if (timeUntilExpiry <= 0) {
            timerElement.textContent = 'Updating...';
        } else {
            timerElement.textContent = `Updates in ${formatTime(timeUntilExpiry)}`;
        }
    }

    // Initial update
    updateDisplay();

    // Update every second
    intervalId = setInterval(updateDisplay, 1000);

    return {
        update: updateDisplay,
        destroy: () => {
            if (intervalId) {
                clearInterval(intervalId);
            }
            if (timerElement && timerElement.parentNode) {
                timerElement.remove();
            }
        }
    };
}

/**
 * Generate cache keys for submissions data
 * @param {string[]} usernames - Array of usernames
 * @param {number} limit - Submission limit
 * @returns {string[]} - Array of cache keys
 */
export function getSubmissionsCacheKeys(usernames, limit) {
    return usernames.map(username => `submissions_${username}_${limit}`);
}

/**
 * Generate cache keys for user stats data
 * @param {string[]} usernames - Array of usernames
 * @returns {string[]} - Array of cache keys
 */
export function getUserStatsCacheKeys(usernames) {
    return usernames.map(username => `user_stats_${username}`);
}
