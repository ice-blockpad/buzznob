# Article Deletion Scripts - Usage Guide

## Overview

Three scripts are available for deleting articles from your Buzznob app database:

| Script | Safety | Use Case |
|--------|--------|----------|
| `deleteAllArticlesInteractive.js` | ⭐ **SAFEST** | Delete all articles with confirmation prompts |
| `deleteAllArticles.js` | ⚠️ **CAUTION** | Delete all articles immediately (no prompts) |
| `deletePendingArticles.js` | ✅ Safe | Delete only pending articles |

---

## 1. Interactive Deletion (Recommended)

### `deleteAllArticlesInteractive.js`

**Best for:** Manual database cleanup, testing, development reset

**Usage:**
```bash
cd backend
node src/scripts/deleteAllArticlesInteractive.js
```

**What happens:**
1. Shows current database statistics
2. Asks "Are you sure?" (type `yes`)
3. Asks for final confirmation (type `DELETE ALL`)
4. Deletes all articles and related data
5. Shows deletion summary

**Example output:**
```
═══════════════════════════════════════════════════════════
   🗑️  DELETE ALL ARTICLES AND NEWS CONTENT
═══════════════════════════════════════════════════════════

⚠️  WARNING: This will PERMANENTLY delete ALL articles and related data!

📊 Current Database Statistics:

   Articles:
   - Total: 150
   - Published: 120
   - Pending: 25
   - Rejected: 5

   Related Data:
   - Read Articles: 450
   - User Activities: 450

⚠️  This action CANNOT be undone!

Are you sure you want to delete ALL articles? (yes/no): yes

⚠️  FINAL CONFIRMATION: Type "DELETE ALL" to proceed: DELETE ALL

⏳ Starting deletion process...

🗑️  Deleting read articles...
   ✅ Deleted 450 read article records
🗑️  Deleting user activities...
   ✅ Deleted 450 user activity records
🗑️  Deleting all articles...
   ✅ Deleted 150 articles

📊 Verification:

   - Remaining Articles: 0
   - Remaining Read Articles: 0
   - Remaining User Activities: 0

✅ ALL articles and related data successfully deleted!

═══════════════════════════════════════════════════════════
   📋 DELETION SUMMARY
═══════════════════════════════════════════════════════════
   - Total Articles Deleted: 150
   - Read Articles Deleted: 450
   - User Activities Deleted: 450
═══════════════════════════════════════════════════════════

✅ Cleanup complete!
```

---

## 2. Non-Interactive Deletion (Use with Caution)

### `deleteAllArticles.js`

**Best for:** Automated scripts, CI/CD pipelines, scheduled cleanup

**⚠️ WARNING:** This script deletes immediately without asking for confirmation!

**Usage:**
```bash
cd backend
node src/scripts/deleteAllArticles.js
```

**What happens:**
1. Shows current database statistics
2. Immediately starts deletion (no prompts!)
3. Deletes all articles and related data
4. Shows deletion summary

**Use cases:**
- Automated testing environments
- CI/CD pipeline cleanup
- Scheduled maintenance tasks
- Development environment resets

---

## 3. Delete Pending Articles Only

### `deletePendingArticles.js`

**Best for:** Cleaning up draft/pending articles without affecting published content

**Usage:**
```bash
cd backend
node src/scripts/deletePendingArticles.js
```

**What it deletes:**
- Only articles with `status = 'pending'`
- Does NOT delete published or rejected articles
- Related ReadArticle and UserActivity records are automatically removed (cascade delete)

---

## What Gets Deleted?

When you delete articles, the following data is removed:

### 1. **Articles Table** (`articles`)
- Article title, content, category
- Source URL and source name
- Images, metadata, timestamps
- Author and reviewer information

### 2. **Reading History** (`read_articles`)
- Records of which users have read which articles
- Reading timestamps
- Reward claim timestamps

### 3. **User Activities** (`user_activities`)
- Points earned from reading articles
- Reading duration
- Completion timestamps

### What is NOT deleted:
- User accounts and profiles
- User points (total points remain unchanged)
- Other user data (badges, rewards, etc.)

---

## Safety Tips

### ✅ DO:
- Use the interactive script when manually deleting
- Check the statistics shown before confirming
- Make database backups before bulk deletions
- Test in development environment first
- Use `deletePendingArticles.js` if you only want to clean drafts

### ❌ DON'T:
- Run `deleteAllArticles.js` in production without backup
- Delete articles during peak usage times
- Skip reading the confirmation prompts
- Assume you can undo the deletion (you can't!)

---

## Environment Requirements

All scripts require:
- Node.js installed
- `.env` file configured with `DATABASE_URL`
- PostgreSQL database connection
- Prisma client generated (`npx prisma generate`)

---

## Troubleshooting

### Database Connection Error
```
Error: Can't reach database server
```
**Solution:** Check your `DATABASE_URL` in `.env` file

### Permission Denied
```
Error: permission denied
```
**Solution:** Ensure your database user has DELETE permissions

### No Articles to Delete
```
✅ No articles to delete
```
**Solution:** Database is already empty, no action needed

---

## Example Workflow

### Scenario: Reset Development Database

```bash
# 1. Navigate to backend directory
cd backend

# 2. Run interactive deletion script
node src/scripts/deleteAllArticlesInteractive.js

# 3. Follow prompts
# - Type "yes" when asked
# - Type "DELETE ALL" for final confirmation

# 4. Verify deletion
# - Check the verification output
# - Should show 0 remaining articles

# 5. Re-populate with new articles (optional)
node src/scripts/fetchAndPostNews.js
```

---

## Additional Commands

### Check Article Count (using psql)
```bash
psql -d your_database_name -c "SELECT COUNT(*) FROM articles;"
```

### Check All Tables Count
```bash
psql -d your_database_name -c "
SELECT 
  'Articles' as table, COUNT(*) FROM articles
  UNION ALL
  SELECT 'Read Articles', COUNT(*) FROM read_articles
  UNION ALL
  SELECT 'User Activities', COUNT(*) FROM user_activities;
"
```

---

## Support

For issues or questions:
1. Check the main README.md
2. Review backend/src/scripts/README.md
3. Contact the development team

---

**Last Updated:** December 2025

