import getACSubmissions from '../GQLQueries/recentACSubmissions.js';
import getUserProblemStats from '../GQLQueries/getUserProblemStats.js';
import getUserProfilePic from '../GQLQueries/getUserProfilePic.js';
import { displayFriendsList, displayLeaderboard, displayACSubmissions, displayStrikesUsers } from './display.js';


/**
 * Listener for username submission
 * 
 * Triggered when user clicks "Submit" button to enter their username at 
 * beginning of extension. 
 * 
 * Checks if valid and fetch AC and leaderboard data. 
 */
document.getElementById('submit-username').addEventListener('click', async () => {
  const username = document.getElementById('username').value;
  // check if the username is valid by calling getUserProfilePic
  const userData = await getUserProfilePic(username);

  if (username) {
    if (userData === null) {
      alert('The username you entered is invalid. Please try again.');
    } else {
      chrome.storage.local.set({ username: username }, async function() {
        console.log('Username is set to ' + username);
        const data = await getACSubmissions(username, 5);
        displayACSubmissions(data, username);
        showPage('activity');

        // display leaderboard for first time, repeat code since DOM update already happened
        // Load in daily leaderboard data
        const dailyData = await loadDailyLeaderboardData([], username);

        // Load strikes users data with stored max strikes and timezone values
        chrome.storage.local.get({ maxStrikes: 3, timezone: '-6' }, async (result) => {
          const maxStrikes = result.maxStrikes;
          const timezone = result.timezone === 'local' ? 'local' : parseFloat(result.timezone);
          document.getElementById('max-strikes-input').value = maxStrikes;
          document.getElementById('timezone-select').value = result.timezone;
          const { strikesUsers, clearedStrikesUsers } = await loadStrikesUsersData([], username, maxStrikes, timezone);
          cachedStrikesData = strikesUsers;
          cachedClearedStrikesData = clearedStrikesUsers;
          displayStrikesUsers(strikesUsers, clearedStrikesUsers, username);
        });

        let leaderboardData = [await getUserProblemStats(username)];
        console.log(leaderboardData)


        // Fetch all profile pics
        leaderboardData = leaderboardData.map(async (stat) => {
          const userData = await getUserProfilePic(stat.username);
          const avatar = userData.userAvatar;
          return { ...stat, avatar };
        });

        const leaderboardTabs = document.querySelectorAll('.leaderboard-tab');
        Promise.all(leaderboardData).then((friendData) => {
          leaderboardTabs.forEach(tab => {
            tab.addEventListener('click', () => {
              // once tab is clicked, change active and display new leaderboard data
              leaderboardTabs.forEach(t => t.classList.remove('active'));
              tab.classList.add('active');
              let difficulty = tab.getAttribute('data-difficulty');
              const diffMap = {"All": 0, "Easy": 1, "Medium": 2, "Hard": 3, "Daily": 4};
              displayLeaderboard(friendData, dailyData, username, diffMap[difficulty]);
            });
          });
          // load default tab as All for leaderboard
          const defaultTab = document.querySelector('.leaderboard-tab[data-difficulty="All"]');
          defaultTab.classList.add('active');
          displayLeaderboard(friendData, null, username, 0);
        })

      });
    }
  } else {
    alert('Empty username. Please enter a username');
  }
});     


/**
 * Listener for DOM Content Load (beginning of extension open)
 * 
 * Validate current username, fetch AC submissions of self and friendss,
 * fetch friend list, and fetch leaderboard data
 */
document.addEventListener('DOMContentLoaded', function() {
    // DISABLED COLOR SCHEME TOGGLE - light mode looks bad
    // document.getElementById('mode-toggle').addEventListener('change', function() {
    //     if (this.checked) {
    //         document.documentElement.setAttribute('data-theme', 'light');
    //     } else {
    //         document.documentElement.setAttribute('data-theme', 'dark');
    //     }
    // });

    // check if username is already stored, else prompt
    chrome.storage.local.get('username', async function(result) {
        if (!result.username) {
            showPage('username-input');
        } else {
            console.log('Welcome back, ' + result.username);
            // load in user AC data
            let allSubmissions = [];
            const data = await getACSubmissions(result.username, 5);
            allSubmissions = allSubmissions.concat(data);
            const currUsername = result.username;

            // load in friend data
            chrome.storage.local.get({ friends: [] }, async (result) => {
              displayFriendsList(result.friends);

              // Load in AC data for activity page - CHANGE LIMIT BASED ON FRIENDS LIST
              // need to do this so promises resolve before updating in forEach
              Promise.all(result.friends.map(friend => getACSubmissions(friend, 5))).then((friendData) => {
                friendData.forEach((submissions) => {
                  allSubmissions = allSubmissions.concat(submissions);
                })
                displayACSubmissions(allSubmissions, currUsername);
              });
              // default to activity page
              showPage('activity');

              // Load in daily leaderboard data
              const dailyData = await loadDailyLeaderboardData(result.friends, currUsername);
              console.log(dailyData);

              // Load strikes users data with stored max strikes and timezone values
              chrome.storage.local.get({ maxStrikes: 3, timezone: '-6' }, async (strikesResult) => {
                const maxStrikes = strikesResult.maxStrikes;
                const timezone = strikesResult.timezone === 'local' ? 'local' : parseFloat(strikesResult.timezone);
                document.getElementById('max-strikes-input').value = maxStrikes;
                document.getElementById('timezone-select').value = strikesResult.timezone;
                const { strikesUsers, clearedStrikesUsers } = await loadStrikesUsersData(result.friends, currUsername, maxStrikes, timezone);
                cachedStrikesData = strikesUsers;
                cachedClearedStrikesData = clearedStrikesUsers;
                displayStrikesUsers(strikesUsers, clearedStrikesUsers, currUsername);
              });

              // Load in friend leaderboard data
              let leaderboardData = await getUserProblemStats(currUsername);
              Promise.all(result.friends.map(friend => getUserProblemStats(friend))).then((friendData) => {
                // fetch profile pics for each user
                
                // for each tab listen for click
                const leaderboardTabs = document.querySelectorAll('.leaderboard-tab');
                friendData.push(leaderboardData);

                // Fetch all profile pics
                friendData = friendData.map(async (stat) => {
                  const userData = await getUserProfilePic(stat.username);
                  const avatar = userData.userAvatar;
                  return { ...stat, avatar };
                });

                Promise.all(friendData).then((friendData) => {
                  leaderboardTabs.forEach(tab => {
                    tab.addEventListener('click', () => {
                      // once tab is clicked, change active and display new leaderboard data
                      leaderboardTabs.forEach(t => t.classList.remove('active'));
                      tab.classList.add('active');
                      let difficulty = tab.getAttribute('data-difficulty');
                      const diffMap = {"All": 0, "Easy": 1, "Medium": 2, "Hard": 3, "Daily": 4};
                      displayLeaderboard(friendData, dailyData, currUsername, diffMap[difficulty]);
                    });
                  });
                  // load default tab as All for leaderboard
                  const defaultTab = document.querySelector('.leaderboard-tab[data-difficulty="All"]');
                  defaultTab.classList.add('active');
                  displayLeaderboard(friendData, null, currUsername, 0);
                })
                
              });

            });
        }
    });
});


/**
 * Loads daily leaderboard data for the current user and their friends.
 * Retrieves recent submissions for the current user and their friends,
 * filters them to include only today's submissions, and sorts the users
 * based on the count of their submissions.
 * @param {string[]} friends - An array of usernames representing the friends of the current user.
 * @param {string} username - The username of the current user.
 * @returns {object[]} -An array of user objects containing daily leaderboard data.
 */
async function loadDailyLeaderboardData(friends, username) {
  let allSubmissions = [];
  
  // Get personal data
  const personalData = await getACSubmissions(username, 20);
  allSubmissions.push({
    username: username,
    submissions: personalData
  });

  // Fetch past 20 submissions for each friend
  const friendDataPromises = friends.map(async friend => {
    const submissions = await getACSubmissions(friend, 20);
    const currFriend = submissions.length > 0 ? submissions[0].username : "No Name";
    return {
      username: currFriend,
      submissions: submissions
    };
  });

  // Wait for all friend data promises to resolve
  const friendData = await Promise.all(friendDataPromises);
  allSubmissions = allSubmissions.concat(friendData);

  // Fetch profile pics for all users
  const allSubmissionsWithAvatarPromises = allSubmissions.map(async (stat) => {
    const userData = await getUserProfilePic(stat.username);
    const avatar = userData.userAvatar;
    return { ...stat, avatar };
  });

  // Wait for all profile pic promises to resolve
  const allSubmissionsWithAvatar = await Promise.all(allSubmissionsWithAvatarPromises);

  // Now filter all submissions for each user
  allSubmissionsWithAvatar.forEach((user) => {
    user.submissions = user.submissions.filter(submission => isToday(submission.timestamp));
    user.count = user.submissions.length;
  });

  // Sort the submissions
  allSubmissionsWithAvatar.sort((x, y) => y.count - x.count);

  return allSubmissionsWithAvatar;
}


/**
 *  Helper function to filter submissions from today
 */
function isToday(timestamp) {
    const today = new Date();
    const date = new Date(timestamp * 1000);
    return date.getDate() === today.getDate() &&
           date.getMonth() === today.getMonth() &&
           date.getFullYear() === today.getFullYear();
}


/**
 * Helper function to check if a timestamp is from yesterday in specified timezone
 * @param {number} timestamp - Unix timestamp
 * @param {number|string} timezoneOffset - UTC offset in hours (e.g., -6 for CST) or 'local' for user's timezone
 * @returns {boolean} - True if timestamp is from yesterday
 */
function isYesterday(timestamp, timezoneOffset) {
    const date = new Date(timestamp * 1000);

    // Determine the offset to use
    let offsetMinutes;
    if (timezoneOffset === 'local') {
        // Use the user's local timezone offset (in minutes, inverted sign)
        offsetMinutes = -new Date().getTimezoneOffset();
    } else {
        // Use the provided UTC offset (convert hours to minutes)
        offsetMinutes = timezoneOffset * 60;
    }

    // Get current date in target timezone
    const nowUTC = new Date();
    const nowTZ = new Date(nowUTC.getTime() + offsetMinutes * 60 * 1000);

    // Get the submission date in target timezone
    const submissionTZ = new Date(date.getTime() + offsetMinutes * 60 * 1000);

    // Calculate yesterday's date in target timezone
    const yesterdayTZ = new Date(nowTZ);
    yesterdayTZ.setDate(yesterdayTZ.getDate() - 1);

    return submissionTZ.getUTCDate() === yesterdayTZ.getUTCDate() &&
           submissionTZ.getUTCMonth() === yesterdayTZ.getUTCMonth() &&
           submissionTZ.getUTCFullYear() === yesterdayTZ.getUTCFullYear();
}


/**
 * Helper function to check if a timestamp is from a specific day offset in specified timezone
 * @param {number} timestamp - Unix timestamp
 * @param {number} daysAgo - Number of days before today (0 = today, 1 = yesterday, etc.)
 * @param {number|string} timezoneOffset - UTC offset in hours (e.g., -6 for CST) or 'local' for user's timezone
 * @returns {boolean} - True if timestamp is from the specified day
 */
function isDaysAgo(timestamp, daysAgo, timezoneOffset) {
    const date = new Date(timestamp * 1000);

    // Determine the offset to use
    let offsetMinutes;
    if (timezoneOffset === 'local') {
        // Use the user's local timezone offset (in minutes, inverted sign)
        offsetMinutes = -new Date().getTimezoneOffset();
    } else {
        // Use the provided UTC offset (convert hours to minutes)
        offsetMinutes = timezoneOffset * 60;
    }

    // Get current date in target timezone
    const nowUTC = new Date();
    const nowTZ = new Date(nowUTC.getTime() + offsetMinutes * 60 * 1000);

    // Get the submission date in target timezone
    const submissionTZ = new Date(date.getTime() + offsetMinutes * 60 * 1000);

    // Calculate the target date in target timezone
    const targetDateTZ = new Date(nowTZ);
    targetDateTZ.setDate(targetDateTZ.getDate() - daysAgo);

    return submissionTZ.getUTCDate() === targetDateTZ.getUTCDate() &&
           submissionTZ.getUTCMonth() === targetDateTZ.getUTCMonth() &&
           submissionTZ.getUTCFullYear() === targetDateTZ.getUTCFullYear();
}


/**
 * Loads strikes users data - calculates consecutive days users haven't solved problems
 * starting from yesterday and checking up to maxStrikes days back
 * @param {string[]} friends - An array of usernames representing the friends of the current user
 * @param {string} username - The username of the current user
 * @param {number} maxStrikes - Maximum number of strikes to check (days back from yesterday)
 * @param {number|string} timezoneOffset - UTC offset in hours (e.g., -6 for CST) or 'local' for user's timezone
 * @returns {object[]} - An array of user objects with their strike count
 */
async function loadStrikesUsersData(friends, username, maxStrikes = 3, timezoneOffset = -6) {
  let allUsers = [username, ...friends];
  let strikesUsers = [];
  let clearedStrikesUsers = [];

  // Check each user
  for (const user of allUsers) {
    const submissions = await getACSubmissions(user, 30);

    // Check if user solved a problem today
    const todaySubmissions = submissions.filter(submission =>
      isToday(submission.timestamp)
    );
    const clearsToday = todaySubmissions.length > 0;

    // Count consecutive days starting from yesterday (up to maxStrikes days)
    let strikeCount = 0;
    for (let daysAgo = 1; daysAgo <= maxStrikes; daysAgo++) {
      const daySubmissions = submissions.filter(submission =>
        isDaysAgo(submission.timestamp, daysAgo, timezoneOffset)
      );

      // If no submissions for this day, increment strike
      if (daySubmissions.length === 0) {
        strikeCount++;
      } else {
        // Stop counting if user was active (consecutive streak broken)
        break;
      }
    }

    const userData = await getUserProfilePic(user);

    // Check if user solved yesterday
    const yesterdaySubmissions = submissions.filter(submission =>
      isDaysAgo(submission.timestamp, 1, timezoneOffset)
    );
    const solvedYesterday = yesterdaySubmissions.length > 0;

    // Add to appropriate list
    if (strikeCount > 0) {
      // User has current strikes
      strikesUsers.push({
        username: user,
        avatar: userData.userAvatar,
        strikes: strikeCount,
        clearsToday: clearsToday
      });
    } else if (solvedYesterday) {
      // User solved yesterday and has no current strikes
      // Check if they would have had strikes if they didn't solve yesterday
      // by checking if they have any missing days from day 2 onwards
      let wouldHaveHadStrikes = false;
      for (let daysAgo = 2; daysAgo <= maxStrikes + 1; daysAgo++) {
        const daySubmissions = submissions.filter(submission =>
          isDaysAgo(submission.timestamp, daysAgo, timezoneOffset)
        );
        if (daySubmissions.length === 0) {
          // Found a gap - this means they would have had strikes
          wouldHaveHadStrikes = true;
          break;
        } else {
          // Found a submission - streak was broken, so no previous strikes
          break;
        }
      }

      // Only add to cleared list if they actually cleared strikes
      if (wouldHaveHadStrikes) {
        clearedStrikesUsers.push({
          username: user,
          avatar: userData.userAvatar,
          clearedStrikes: true
        });
      }
    }
  }

  // Sort by strikes descending (most strikes first)
  strikesUsers.sort((a, b) => b.strikes - a.strikes);

  return { strikesUsers, clearedStrikesUsers };
}


/**
 * Listener for add friend button 
 * 
 * Check if the entered username is valid, if so add, else throw error
 */
document.getElementById('add-friend-btn').addEventListener('click', async () => {
  const friendUsername = document.getElementById('friend-username').value.trim();

  // check if the username is valid by calling getUserProfilePic
  const userData = await getUserProfilePic(friendUsername);

  if (friendUsername) {

    if (userData === null) {
      alert('The username you entered is invalid. Please try again.');
    } else {
      chrome.storage.local.get({ friends: [] }, (result) => {
      const friends = result.friends;
        if (!friends.includes(friendUsername)) {
          friends.push(friendUsername);
          chrome.storage.local.set({ friends }, () => {
            console.log(`Friend ${friendUsername} added.`);
            displayFriendsList(friends);
          });
        } else {
          console.log(`Friend ${friendUsername} is already in the list.`);
        }
      });
    }
  } else {
    alert('Empty username. Please enter a username');
  }
});



/**
 * Listener for update max strikes button
 */
document.getElementById('update-max-strikes-btn').addEventListener('click', async () => {
  const maxStrikesInput = document.getElementById('max-strikes-input');
  const maxStrikes = parseInt(maxStrikesInput.value);

  if (maxStrikes < 1 || maxStrikes > 30) {
    alert('Please enter a value between 1 and 30');
    return;
  }

  // Store the max strikes value
  chrome.storage.local.set({ maxStrikes: maxStrikes }, async () => {
    console.log('Max strikes set to ' + maxStrikes);

    // Reload strikes data with new max value and current timezone
    chrome.storage.local.get(['username', 'friends', 'timezone'], async (result) => {
      if (result.username) {
        const timezone = result.timezone === 'local' ? 'local' : parseFloat(result.timezone || '-6');
        const { strikesUsers, clearedStrikesUsers } = await loadStrikesUsersData(result.friends || [], result.username, maxStrikes, timezone);
        cachedStrikesData = strikesUsers;
        cachedClearedStrikesData = clearedStrikesUsers;
        displayStrikesUsers(strikesUsers, clearedStrikesUsers, result.username);
      }
    });
  });
});

/**
 * Listener for timezone setting change
 */
document.getElementById('timezone-select').addEventListener('change', async () => {
  const timezoneSelect = document.getElementById('timezone-select');
  const selectedTimezone = timezoneSelect.value;

  // Store the timezone value
  chrome.storage.local.set({ timezone: selectedTimezone }, async () => {
    console.log('Timezone set to ' + selectedTimezone);

    // Reload strikes data with new timezone
    chrome.storage.local.get(['username', 'friends', 'maxStrikes'], async (result) => {
      if (result.username) {
        const maxStrikes = result.maxStrikes || 3;
        const timezone = selectedTimezone === 'local' ? 'local' : parseFloat(selectedTimezone);
        const { strikesUsers, clearedStrikesUsers } = await loadStrikesUsersData(result.friends || [], result.username, maxStrikes, timezone);
        cachedStrikesData = strikesUsers;
        cachedClearedStrikesData = clearedStrikesUsers;
        displayStrikesUsers(strikesUsers, clearedStrikesUsers, result.username);
      }
    });
  });
});

/**
 * Listener for copy strikes button
 */
let cachedStrikesData = [];
let cachedClearedStrikesData = [];

document.getElementById('copy-strikes-btn').addEventListener('click', () => {
  if ((!cachedStrikesData || cachedStrikesData.length === 0) && (!cachedClearedStrikesData || cachedClearedStrikesData.length === 0)) {
    alert('No strikes data to copy!');
    return;
  }

  // Build the formatted text
  let clipboardText = '';

  // Add cleared strikes users first (with checkmark)
  if (cachedClearedStrikesData && cachedClearedStrikesData.length > 0) {
    cachedClearedStrikesData.forEach(user => {
      clipboardText += `${user.username} ✅\n`;
    });
    clipboardText += '\n';
  }

  // Group users by strike count
  const strikeGroups = {};
  cachedStrikesData.forEach(user => {
    if (!strikeGroups[user.strikes]) {
      strikeGroups[user.strikes] = [];
    }
    strikeGroups[user.strikes].push(user.username);
  });

  // Sort strike numbers in ascending order
  const sortedStrikeNumbers = Object.keys(strikeGroups)
    .map(Number)
    .sort((a, b) => a - b);

  // Add strikes sections
  sortedStrikeNumbers.forEach(strikeCount => {
    const emojis = '❌'.repeat(strikeCount);
    clipboardText += `Strike ${strikeCount} ${emojis}:\n`;
    strikeGroups[strikeCount].forEach(username => {
      clipboardText += `${username}\n`;
    });
    clipboardText += '\n';
  });

  // Copy to clipboard
  navigator.clipboard.writeText(clipboardText.trim()).then(() => {
    // Visual feedback
    const button = document.getElementById('copy-strikes-btn');
    const originalText = button.textContent;
    button.textContent = '✓';
    setTimeout(() => {
      button.textContent = originalText;
    }, 1000);
  }).catch(err => {
    console.error('Failed to copy:', err);
    alert('Failed to copy to clipboard');
  });
});

/**
 * Listener for tab changes
 */
document.getElementById('activity-tab').addEventListener('click', () => showPage('activity'));
document.getElementById('friends-tab').addEventListener('click', () => showPage('friends'));
document.getElementById('leaderboard-tab').addEventListener('click', () => showPage('leaderboard'));
document.getElementById('strikes-tab').addEventListener('click', () => showPage('strikes'));

/**
 * Changes which page is shown as content based off tab bar.
 * @param {String} pageId - The id of the page chosen.
 */
function showPage(pageId) {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
    });
    
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });

    document.getElementById(pageId).classList.add('active');
    const activeTabId = (pageId === 'username-input') ? null : `${pageId.concat('-tab')}`;
    if (activeTabId) {
        document.getElementById(activeTabId).classList.add('active');
    } 
}

