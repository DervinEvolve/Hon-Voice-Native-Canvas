# Canvas History Architecture - Performance & Cost Analysis

## ✅ Yes, Run in Supabase SQL Editor

This migration should be executed in the **Supabase SQL Editor** (Dashboard → SQL Editor → New Query).

## Performance Optimizations

### ✅ Already Implemented
1. **Indexes** - Optimized for common queries:
   - `(project_id, created_at DESC)` - Fast timeline queries
   - Partial indexes on `voice_event_id` and `conversation_id`
   - GIN index on `canvas_state` for JSONB queries

2. **Automatic Size Calculation** - Trigger calculates snapshot size for monitoring

3. **Cleanup Functions** - Prevent unbounded growth:
   - `cleanup_old_snapshots()` - Keeps last 50 snapshots per project, deletes older than 90 days
   - `cleanup_old_events()` - Deletes events older than 180 days (keeps snapshot-linked events)

4. **Storage Stats** - Monitor usage with `get_project_storage_stats()`

## Cost Considerations

### Storage Estimates
- **Small project** (10 panels, 5 pages): ~50-100 KB per snapshot
- **Medium project** (50 panels, 10 pages): ~200-500 KB per snapshot  
- **Large project** (100+ panels, 20+ pages): ~1-2 MB per snapshot

### Cost Impact (Supabase Free Tier)
- **Free tier**: 500 MB database storage
- **50 snapshots × 500 KB** = ~25 MB per active project
- **~20 active projects** before hitting limits
- **Recommendation**: Run cleanup weekly via cron or edge function

### Cost Optimization Strategies

1. **Automatic Cleanup** (✅ Implemented)
   ```sql
   -- Run weekly via Supabase cron or edge function
   SELECT cleanup_old_snapshots(NULL, 50, 90);
   SELECT cleanup_old_events(180);
   ```

2. **Compression** (Future Enhancement)
   - Store compressed JSONB using `pgcrypto` (extension enabled)
   - Can reduce size by 60-80% for large snapshots
   - Decompress on read

3. **Incremental Snapshots** (Future Enhancement)
   - Store only diffs between snapshots
   - Reconstruct full state on restore
   - Reduces storage by 70-90%

4. **Snapshot Strategy**
   - Current: Auto-snapshot on panel create/delete
   - Consider: Snapshot only on "significant" events (voice tasks, manual saves)

## Scalability Considerations

### Current Limits
- **Timeline query**: Limited to 100 events (configurable)
- **No pagination**: Add cursor-based pagination for large timelines
- **No partitioning**: Consider partitioning by `created_at` for very large datasets

### Recommended Enhancements

1. **Add Pagination to Timeline**
   ```sql
   -- Add cursor-based pagination
   CREATE OR REPLACE FUNCTION public.get_canvas_timeline_cursor(
     p_project_id TEXT,
     p_cursor TIMESTAMP WITH TIME ZONE DEFAULT NULL,
     p_limit INTEGER DEFAULT 50
   )
   ```

2. **Partitioning** (For 1M+ events)
   - Partition `canvas_history_events` by month
   - Partition `canvas_history_snapshots` by year
   - Use PostgreSQL native partitioning

3. **Archival Strategy**
   - Move old snapshots (>1 year) to cold storage (S3)
   - Keep metadata in database for search
   - Restore from S3 when needed

## Monitoring & Maintenance

### Weekly Tasks
```sql
-- Check storage usage
SELECT 
  project_id,
  COUNT(*) as snapshot_count,
  SUM(snapshot_size_bytes) / 1024 / 1024 as size_mb
FROM canvas_history_snapshots
GROUP BY project_id
ORDER BY size_mb DESC;

-- Run cleanup
SELECT cleanup_old_snapshots(NULL, 50, 90);
SELECT cleanup_old_events(180);
```

### Alert Thresholds
- **Project > 100 MB**: Warn user, suggest cleanup
- **Total storage > 400 MB**: Auto-cleanup aggressive mode
- **Events > 10,000 per project**: Archive old events

## Best Practices

1. **Snapshot Frequency**
   - ✅ On panel create/delete (current)
   - ✅ On voice task complete (to implement)
   - ✅ Manual restore points (to implement)
   - ⚠️ Avoid: Every panel move/resize (too frequent)

2. **Event Tracking**
   - ✅ Track all operations (current)
   - ✅ Link to voice events (to implement)
   - ⚠️ Batch small events (e.g., rapid moves)

3. **Restore Strategy**
   - ✅ Full snapshot restore (current)
   - 🔄 Future: Incremental restore from events

## Migration Checklist

- [x] Create tables with proper indexes
- [x] Add RLS policies
- [x] Create helper functions
- [x] Add cleanup functions
- [x] Add size tracking
- [ ] Set up weekly cleanup cron job
- [ ] Add compression (if needed)
- [ ] Add pagination to timeline
- [ ] Monitor storage usage

## Conclusion

**This approach is:**
- ✅ **Performant**: Proper indexes, efficient queries
- ✅ **Cost-effective**: Cleanup prevents unbounded growth
- ✅ **Scalable**: Can handle thousands of projects with proper maintenance

**Run the migration in Supabase SQL Editor**, then set up weekly cleanup via:
- Supabase Edge Function + cron
- Or external cron job calling Supabase API

