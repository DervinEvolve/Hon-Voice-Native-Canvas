# Hon EVI Session Management

## Overview

Implemented production-grade conversation continuity for Hon (Hume EVI) using Supabase database storage and Hume's `resumed_chat_group_id` feature. This ensures Hon remembers context across disconnects, device switches, and browser sessions.

## Problem Solved

**Before:** When Hon disconnected (due to inactivity timeout, network issues, or errors), reconnecting would start a fresh conversation with the intro message, losing all context.

**After:** Hon automatically resumes conversations seamlessly, preserving full context and conversation history.

## Architecture

### Database Layer (`hon_evi_sessions` table)

```sql
CREATE TABLE public.hon_evi_sessions (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id),
  wallet_address text,
  chat_group_id text NOT NULL,          -- Hume's chat group identifier
  current_chat_id text,                  -- Current chat session ID
  is_active boolean DEFAULT true,        -- Only one active per user
  last_active timestamp with time zone,
  started_at timestamp with time zone,
  ended_at timestamp with time zone,
  total_duration_seconds integer,
  message_count integer,
  tool_calls_count integer,
  last_context jsonb,                    -- Session snapshot
  created_at timestamp with time zone,
  updated_at timestamp with time zone
);
```

**Key Features:**
- ✅ Supports both authenticated users and wallet-only users
- ✅ Enforces one active session per user
- ✅ Tracks session metrics (duration, messages, tool calls)
- ✅ Stores context snapshots for recovery
- ✅ RLS policies ensure users only access their own sessions

### Service Layer (`honEviSessionService.ts`)

**Main Functions:**

1. **`initializeSession(userId?, walletAddress?)`**
   - Checks for existing active session
   - Returns `chat_group_id` to resume, or null for fresh start
   - Validates session is recent (< 24 hours)

2. **`storeChatMetadata(chatGroupId, chatId, userId?, walletAddress?)`**
   - Stores new session when receiving `chat_metadata` from Hume
   - Deactivates any previous active sessions
   - Returns session ID for tracking

3. **`deactivateSession(sessionId)`**
   - Marks session as inactive
   - Calculates total duration
   - Called when user explicitly ends conversation

4. **`updateSessionContext(chatGroupId, context)`**
   - Stores session snapshots (for `session_upsert` tool integration)
   - Updates last_active timestamp

### Integration with Hume EVI (`humeEviService.ts`)

**Connection Flow:**

```typescript
async startSession() {
  // 1. Check for existing session
  const resumeChatGroupId = await honEviSessionService.initializeSession(userId, walletAddress);
  
  // 2. Fetch Hume access token
  const { accessToken, configId } = await fetchToken();
  
  // 3. Connect with optional resume parameter
  const connectOptions = {
    configId,
    ...(resumeChatGroupId && { resumedChatGroupId })
  };
  
  this.evi = await client.empathicVoice.chat.connect(connectOptions);
}
```

**Event Handling:**

```typescript
case 'chat_metadata':
  // Received when connection established
  if (event.chat_group_id && event.chat_id) {
    // Store session for future resume
    const sessionId = await honEviSessionService.storeChatMetadata(
      event.chat_group_id,
      event.chat_id,
      userId,
      walletAddress
    );
    
    this.currentSessionId = sessionId;
    this.currentChatGroupId = event.chat_group_id;
  }
  break;
```

**Disconnect Handling:**

```typescript
async endSession() {
  // User explicitly ended conversation
  if (this.currentSessionId) {
    await honEviSessionService.deactivateSession(this.currentSessionId);
    this.currentSessionId = null;
    this.currentChatGroupId = null;
  }
  // ... cleanup audio, keepalive, etc.
}
```

## User Experience

### Scenario 1: Inactivity Timeout
1. User stops talking for 2 minutes (default Hume timeout)
2. WebSocket closes automatically
3. User speaks again → reconnects
4. **Hon resumes mid-conversation** (no intro message!)

### Scenario 2: Network Interruption
1. Network drops briefly
2. Auto-reconnect triggers
3. **Conversation continues seamlessly**

### Scenario 3: Device Switch
1. User on desktop, working with Hon
2. Switches to mobile device
3. Opens app → **Hon remembers entire conversation**
4. Context preserved across devices

### Scenario 4: Explicit End
1. User clicks "End Conversation"
2. Session marked inactive in database
3. Next connection starts fresh (as expected)

## Benefits

### ✅ Production-Ready
- Database-backed (not localStorage)
- Works across devices and browsers
- Supports both authenticated and wallet-only users
- Proper RLS security policies

### ✅ Cross-Session Memory
- Full conversation history preserved
- Works with Hume's built-in memory features
- Compatible with `memory_put/get/search` tools
- Session context snapshots for recovery

### ✅ Graceful Degradation
- If Supabase unavailable → falls back gracefully
- If session too old (>24h) → starts fresh
- If no user identification → works but no persistence

### ✅ Analytics-Friendly
- Track session duration, message count, tool usage
- Query user session history
- Identify patterns and issues

## Configuration Options

### Timeout Settings (via Hume Config)

Recommend increasing from defaults:

```typescript
{
  inactivity_timeout: 900,  // 15 minutes (default: 120s)
  max_duration_timeout: 1800 // 30 minutes (max allowed)
}
```

### Session Expiry

Sessions older than 24 hours are considered expired and won't resume automatically. Configurable in `honEviSessionService.ts`:

```typescript
const hoursSinceActive = (Date.now() - lastActive.getTime()) / (1000 * 60 * 60);
if (hoursSinceActive < 24) { // ← Adjust this threshold
  return existingSession.chat_group_id;
}
```

## Integration with Hume Memory Tools

The session management works **alongside** Hume's memory tools:

### `session_upsert` Tool
```typescript
// Hon can actively save context snapshots
honEviSessionService.updateSessionContext(chatGroupId, {
  current_task: "Creating 10-panel comic",
  panels_created: 5,
  active_models: ["Flux", "Veo3.1"]
});
```

### `memory_put/get` Tools
- Used by Hon for **structured knowledge**
- Session management provides **conversation continuity**
- Together they create comprehensive memory system

## Maintenance

### Cleanup Old Sessions

```typescript
// Run periodically (e.g., via cron job)
await honEviSessionService.cleanupOldSessions(30); // Delete sessions > 30 days old
```

### Session Analytics

```typescript
// Get user's session history
const sessions = await honEviSessionService.getUserSessions(userId, 10);

sessions.forEach(session => {
  console.log({
    duration: session.total_duration_seconds,
    messages: session.message_count,
    tools: session.tool_calls_count,
    started: session.started_at
  });
});
```

## Testing

### Test Inactivity Resume
1. Start conversation with Hon
2. Wait 3+ minutes (past timeout)
3. Speak again
4. ✅ Hon should continue conversation

### Test Cross-Device
1. Start conversation on device A
2. Open app on device B (same user)
3. ✅ Hon should have context from device A

### Test Explicit End
1. Have conversation with Hon
2. Click "End Conversation"
3. Start new conversation
4. ✅ Hon should give intro (fresh start)

## Troubleshooting

### Issue: Hon still gives intro after disconnect

**Check:**
- Is `chat_metadata` event being received? (Check console logs)
- Is session being stored? (Look for `[HonEviSession] Session stored` log)
- Is `resumedChatGroupId` being passed to connect? (Check connection logs)

**Debug:**
```typescript
// Check database
const session = await honEviSessionService.getActiveSession(userId);
console.log('Active session:', session);
```

### Issue: Sessions not persisting across devices

**Check:**
- Is user authenticated properly?
- Does user_id or wallet_address match across devices?
- Check RLS policies in Supabase

### Issue: Multiple active sessions

**Should not happen** due to unique index, but if it does:
```typescript
// Manually cleanup
await supabase
  .from('hon_evi_sessions')
  .update({ is_active: false })
  .eq('user_id', userId)
  .eq('is_active', true);
```

## Future Enhancements

### 1. Pre-Disconnect Warning
Warn user before inactivity timeout kicks in.

### 2. Activity-Based Keepalive
Send activity signals during UI interactions to prevent timeout.

### 3. Session Recovery UI
Show "Resume previous conversation" button if recent session exists.

### 4. Multi-Device Handoff
Explicit "Continue on this device" flow for seamless transitions.

### 5. Session Sharing
Allow users to share conversation history with collaborators.

## Related Documentation

- [Hume EVI Timeouts](https://dev.hume.ai/docs/speech-to-speech-evi/configuration/timeouts)
- [Hume EVI Chat API](https://dev.hume.ai/reference/speech-to-speech-evi/chat)
- [Hume Chat Webhooks](https://dev.hume.ai/reference/speech-to-speech-evi/chat-webhooks/chat-ended)

