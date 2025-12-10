# Quick Start: Delete All Articles

## 🚀 Fastest Way to Delete All Articles

### Option 1: Using npm scripts (Recommended)

```bash
# Interactive deletion (with confirmation prompts) - SAFEST
npm run articles:delete-all

# Force deletion (no prompts) - USE WITH CAUTION
npm run articles:delete-all-force

# Delete only pending articles
npm run articles:delete-pending
```

### Option 2: Direct execution

```bash
# Interactive (recommended)
node src/scripts/deleteAllArticlesInteractive.js

# Force (no confirmation)
node src/scripts/deleteAllArticles.js

# Pending only
node src/scripts/deletePendingArticles.js
```

---

## 📋 What Gets Deleted?

| Data Type | Description |
|-----------|-------------|
| **Articles** | ALL articles (published, pending, rejected) |
| **Reading History** | All user reading records |
| **User Activities** | All article-related activity records |

**Not deleted:** User accounts, user points, badges, rewards

---

## ⚡ Quick Commands

```bash
# 1. Navigate to backend
cd backend

# 2. Delete all articles (with confirmation)
npm run articles:delete-all

# 3. Follow the prompts:
#    - Type "yes" when asked
#    - Type "DELETE ALL" to confirm
```

---

## 🔐 Safety Levels

| Command | Safety | Confirmation Required? |
|---------|--------|----------------------|
| `npm run articles:delete-all` | ⭐⭐⭐ **SAFEST** | Yes (2 prompts) |
| `npm run articles:delete-pending` | ⭐⭐ Safe | No (only pending) |
| `npm run articles:delete-all-force` | ⚠️ **DANGEROUS** | No |

---

## 📖 Need More Info?

- **Detailed Guide:** `backend/src/scripts/DELETION_GUIDE.md`
- **All Scripts:** `backend/src/scripts/README.md`

---

## ✅ Verification

After deletion, you should see:

```
✅ ALL articles and related data successfully deleted!

═══════════════════════════════════════════════════════════
   📋 DELETION SUMMARY
═══════════════════════════════════════════════════════════
   - Total Articles Deleted: [number]
   - Read Articles Deleted: [number]
   - User Activities Deleted: [number]
═══════════════════════════════════════════════════════════
```

---

**Last Updated:** December 2025

