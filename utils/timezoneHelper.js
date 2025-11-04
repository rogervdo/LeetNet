/**
 * Timezone helper utilities for streak calculation
 */

/**
 * Get the user's configured timezone or auto-detect it
 * @returns {Promise<string>} IANA timezone string (e.g., "America/Chicago")
 */
export async function getUserTimezone() {
  try {
    const result = await chrome.storage.sync.get(['userTimezone']);

    if (result.userTimezone) {
      return result.userTimezone;
    }

    // Auto-detect timezone
    const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return detectedTimezone;
  } catch (error) {
    console.error('Error getting timezone:', error);
    // Fallback to system timezone
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
}

/**
 * Set user's timezone preference
 * @param {string} timezone - IANA timezone string
 */
export async function setUserTimezone(timezone) {
  await chrome.storage.sync.set({ userTimezone: timezone });
}

/**
 * Convert UTC timestamp to user's timezone and get the date string (YYYY-MM-DD)
 * @param {number} utcTimestamp - Unix timestamp in seconds
 * @param {string} timezone - IANA timezone string
 * @returns {string} Date string in format YYYY-MM-DD
 */
export function getLocalDateString(utcTimestamp, timezone) {
  const date = new Date(utcTimestamp * 1000);

  // Format date in user's timezone
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  return formatter.format(date); // Returns YYYY-MM-DD format
}

/**
 * Get today's date string in user's timezone
 * @param {string} timezone - IANA timezone string
 * @returns {string} Date string in format YYYY-MM-DD
 */
export function getTodayInTimezone(timezone) {
  const now = new Date();

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  return formatter.format(now);
}

/**
 * Calculate the difference in days between two dates in a specific timezone
 * @param {string} date1 - Date string YYYY-MM-DD
 * @param {string} date2 - Date string YYYY-MM-DD
 * @returns {number} Number of days between dates
 */
export function daysDifference(date1, date2) {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const diffTime = Math.abs(d2 - d1);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

