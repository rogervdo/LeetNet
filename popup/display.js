/**
 * display.js - This file contains methods that render various pages with new data.
 *              Commonly called inside eventListeners from popup.js
 */

import questionDifficulty from '../GQLQueries/questionDifficulty.js';
import { timeDifference } from './helper.js';
import getUserProfilePic from '../GQLQueries/getUserProfilePic.js';

/**
 * Displays the friends list.
 * @param {Array} friends - The list of friends.
 */
export function displayFriendsList(friends) {
  const friendsContainer = document.getElementById('friends-list-container');
  friendsContainer.innerHTML = ''; // Clear previous friends list

  if (!friends || friends.length === 0) {
    friendsContainer.innerHTML = '<p>No friends found.</p>';
    return;
  }

  const list = document.createElement('ul');
  list.classList.add('friends-list');

  friends.forEach(friend => {
    const listItem = document.createElement('li');
    listItem.classList.add('friend-item');

    const friendName = document.createElement('span');
    friendName.textContent = friend;

    const removeButton = document.createElement('button');
    removeButton.textContent = 'x';
    removeButton.classList.add('remove-btn');
    removeButton.addEventListener('click', () => {
        // Remove friend from stored list
        chrome.storage.local.get({ friends: [] }, (result) => {
            const updatedFriends = result.friends.filter(f => f !== friend);
            chrome.storage.local.set({ friends: updatedFriends }, () => {
            displayFriendsList(updatedFriends);
            });
        });
    });

    listItem.appendChild(friendName);
    listItem.appendChild(removeButton);
    list.appendChild(listItem);
  });

  friendsContainer.appendChild(list);
}

/**
 * Displays the leaderboard.
 * @param {Array} leaderboardStats - The leaderboard statistics.
 * @param {string} username - The current username.
 * @param {number} diff - The difficulty level (0: All, 1: Easy, 2: Medium, 3: Hard, 4: Daily).
 *                         4 (Daily) is a special case, not a difficulty.
 */
export function displayLeaderboard(leaderboardStats, dailyStats, username, diff) {
  // choose between default leaderboard stats or daily stats
  if (diff === 4) leaderboardStats = dailyStats;
  // sort by problems solved
  if (diff !== 4) {
    leaderboardStats.sort(function(x, y) {
      return y.acSubmissionNum[diff].count - x.acSubmissionNum[diff].count;
    })
  }
  

  // create container
  const resultsContainer = document.getElementById('leaderboard-results');
  resultsContainer.innerHTML = ''; // Clear previous results

  if (!leaderboardStats || leaderboardStats.length === 0) {
    resultsContainer.innerHTML = '<p>No friends found.</p>';
    return;
  }

  // Fetch all profile pics
  // const newLeaderboardStats = leaderboardStats.map(async (stat) => {
  //   const userData = await getUserProfilePic(stat.username);
  //   const avatar = userData.userAvatar;
  //   return { ...stat, avatar };
  // });

  Promise.all(leaderboardStats).then((leaderboardStats) => {
    // create each list element
    const list = document.createElement('ul');
    list.classList.add('all-problems-list');

    leaderboardStats.forEach( (stat, idx) => {
      const listItem = document.createElement('li');
      listItem.classList.add('stat-row');

      // Avatar
      const avatar = document.createElement('img');
      avatar.classList.add('profile-pic');
      avatar.src = `${stat.avatar}`;
      avatar.alt = `${stat.username}'s profile picture`;

      // Medal for top 3 positions
      let medal = null;
      if (idx === 0) {
        medal = document.createElement('img');
        medal.classList.add('medal-icon');
        medal.src = '../gold-medal.png';
        medal.alt = 'Gold medal';
      } else if (idx === 1) {
        medal = document.createElement('img');
        medal.classList.add('medal-icon');
        medal.src = '../silver-medal.png';
        medal.alt = 'Silver medal';
      } else if (idx === 2) {
        medal = document.createElement('img');
        medal.classList.add('medal-icon');
        medal.src = '../bronze-medal.png';
        medal.alt = 'Bronze medal';
      }

      // Username
      const title = document.createElement('p');
      title.classList.add('stat-row-title');
      title.textContent = `${idx+1}. ${stat.username}`;

      // number of problems solved
      const problemsSolved = (diff === 4) ? stat.count : stat.acSubmissionNum[diff].count;
      const solved = document.createElement('p');
      solved.classList.add('stat-row-solved');
      solved.textContent = `${problemsSolved}`;

      listItem.appendChild(avatar);
      listItem.appendChild(title);
      if (medal) {
        listItem.appendChild(medal);
      }
      listItem.appendChild(solved);

      list.appendChild(listItem);
    });

    resultsContainer.appendChild(list)
   
  });

}

/**
 * Displays most recent AC Submission results of friendss.
 * @param {Array} submissions - The submissions data of all friends and self.
 * @param {string} username - The current username.
 */
/**
 * Displays users with strikes (consecutive days without solving problems).
 * @param {Array} strikesUsers - Array of user objects with username, avatar, and strikes count.
 * @param {Array} clearedStrikesUsers - Array of user objects who cleared their strikes yesterday.
 * @param {string} currentUsername - The current user's username.
 */
export function displayStrikesUsers(strikesUsers, clearedStrikesUsers, currentUsername) {
  const resultsContainer = document.getElementById('strikes-list');
  resultsContainer.innerHTML = ''; // Clear previous results

  if ((!strikesUsers || strikesUsers.length === 0) && (!clearedStrikesUsers || clearedStrikesUsers.length === 0)) {
    resultsContainer.innerHTML = '<p>No strikes! Everyone is staying active!</p>';
    return;
  }

  const list = document.createElement('ul');
  list.classList.add('strikes-users-list');

  // Display users with current strikes
  strikesUsers.forEach(user => {
    const listItem = document.createElement('li');
    listItem.classList.add('strikes-user-item');

    // Avatar
    const avatar = document.createElement('img');
    avatar.classList.add('profile-pic');
    avatar.src = user.avatar;
    avatar.alt = `${user.username}'s profile picture`;

    // Username (display "You" for current user)
    const username = document.createElement('p');
    username.classList.add('strikes-username');
    username.textContent = user.username === currentUsername ? 'You' : user.username;

    // "Clears Today" indicator (if user solved a problem today)
    const clearsTodayIndicator = document.createElement('p');
    clearsTodayIndicator.classList.add('clears-today');
    if (user.clearsToday) {
      clearsTodayIndicator.textContent = 'Clears Today';
    }

    // Strikes display with X emojis
    const strikesDisplay = document.createElement('div');
    strikesDisplay.classList.add('strikes-display');

    const strikesText = document.createElement('p');
    strikesText.classList.add('strikes-text');
    strikesText.textContent = `Strike ${user.strikes}`;

    const strikesEmojis = document.createElement('p');
    strikesEmojis.classList.add('strikes-emojis');
    strikesEmojis.textContent = '❌'.repeat(user.strikes);

    strikesDisplay.appendChild(strikesText);
    strikesDisplay.appendChild(strikesEmojis);

    listItem.appendChild(avatar);
    listItem.appendChild(username);
    listItem.appendChild(clearsTodayIndicator);
    listItem.appendChild(strikesDisplay);
    list.appendChild(listItem);
  });

  // Display users who cleared their strikes yesterday (at the bottom)
  if (clearedStrikesUsers && clearedStrikesUsers.length > 0) {
    clearedStrikesUsers.forEach(user => {
      const listItem = document.createElement('li');
      listItem.classList.add('strikes-user-item', 'cleared-strikes');

      // Avatar
      const avatar = document.createElement('img');
      avatar.classList.add('profile-pic');
      avatar.src = user.avatar;
      avatar.alt = `${user.username}'s profile picture`;

      // Username (display "You" for current user)
      const username = document.createElement('p');
      username.classList.add('strikes-username');
      username.textContent = user.username === currentUsername ? 'You' : user.username;

      // Checkmark indicator
      const checkmarkDisplay = document.createElement('div');
      checkmarkDisplay.classList.add('cleared-display');

      const checkmarkEmoji = document.createElement('p');
      checkmarkEmoji.classList.add('checkmark-emoji');
      checkmarkEmoji.textContent = '✅';

      checkmarkDisplay.appendChild(checkmarkEmoji);

      listItem.appendChild(avatar);
      listItem.appendChild(username);
      listItem.appendChild(checkmarkDisplay);
      list.appendChild(listItem);
    });
  }

  resultsContainer.appendChild(list);
}

export async function displayACSubmissions(submissions, username) {
  const resultsContainer = document.getElementById('graphql-results');
  resultsContainer.innerHTML = ''; // Clear previous results

  if (!submissions || submissions.length === 0) {
    resultsContainer.innerHTML = '<p>No submissions found.</p>';
    return;
  }
  submissions.sort(function(x, y) {
    return y.timestamp - x.timestamp;
  })
  console.log(submissions)
  

  // Fetch all difficulties
  const submissionWithDifficultyPromises = submissions.map(async (submission) => {
    const problem_data = await questionDifficulty(submission.titleSlug);
    const difficulty = problem_data.difficulty;
    return { ...submission, difficulty };
  });

  // wait for fetching difficulties and then populate activity list with submissions in 
  // order of most recent
  Promise.all(submissionWithDifficultyPromises).then((submissionsWithDiff) => {
    const list = document.createElement('ul');
    list.classList.add('submission-list');

    submissionsWithDiff.forEach( submission => {
      // display current user as You
      if (submission.username === username) {
        submission.username = "You";
      }
      const problemLink = "https://leetcode.com/problems/" + submission.titleSlug + "/description/";

      const listItem = document.createElement('li');
      listItem.classList.add('submission');

      // create "User solved problem" with link
      const title = document.createElement('p');
      title.classList.add('submission-title');
      
      const titleLink = document.createElement('a');
      titleLink.href = problemLink;
      titleLink.textContent = submission.title;
      titleLink.target = '_blank'; // open link in a new tab
      titleLink.classList.add('submission-link'); 
      
      title.innerHTML = `${submission.username} solved `;
      title.appendChild(titleLink);

      // problem difficulty
      const diff = document.createElement('p');
      diff.classList.add('submission-diff');
      diff.classList.add(`${submission.difficulty.toLowerCase()}`);
      diff.textContent = `${submission.difficulty}`;

      // timestamp
      const timestamp = document.createElement('p');
      timestamp.classList.add('submission-timestamp');
      timestamp.textContent = `${timeDifference(Date.now(), new Date(submission.timestamp * 1000))}`;

      // listItem.appendChild(user);
      listItem.appendChild(title);
      listItem.appendChild(diff);
      listItem.appendChild(timestamp);

      list.appendChild(listItem);
    });

    resultsContainer.appendChild(list) 
  });

}