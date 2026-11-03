# Hon Personalization Setup

## Overview

Hon now automatically greets users by their first name and maintains personalized interactions throughout the session. This is achieved through **Hume EVI's dynamic variables** feature combined with user profile data from Supabase.

## How It Works

1. **On Connection**: When a user starts a conversation with Hon, the app:
   - Fetches the user's `first_name` from the Supabase `profiles` table
   - Passes it as a session variable to Hume EVI
   - Available immediately for the entire session

2. **In Conversation**: Hon can reference the user by name naturally:
   - "Hey Sarah, I'd love to help you create that comic!"
   - "Great choice, John! Let me generate that image for you."
   - "Welcome back, Alex! Ready to continue where we left off?"

3. **Session Persistence**: Combined with session management:
   - User's name is remembered across disconnects
   - Works across devices (same user = same name)
   - No repeated introductions needed

## Hume Dashboard Configuration

To enable personalization, you need to update Hon's **system prompt** in the Hume dashboard to use dynamic variables.

### Step 1: Access Configuration

1. Go to [platform.hume.ai/evi/configs](https://platform.hume.ai/evi/configs)
2. Select your Hon configuration (the one with ID: `6d8ca6a1-7ff6-4bb0-bcfa-8881a3d28097`)
3. Click "Edit" to modify the configuration

### Step 2: Update System Prompt

Add dynamic variable references to Hon's system prompt. You can use any of these variables:

- **`{{user_name}}`** - User's first name (preferred) or username fallback
- **`{{user_first_name}}`** - User's first name only
- **`{{user_username}}`** - User's username only

#### Example Integration:

**Before:**
```
You are Hon, a creative AI assistant specialized in comic creation...
```

**After:**
```
You are Hon, a creative AI assistant specialized in comic creation.
{{#if user_name}}The user you're speaking with is {{user_name}}.{{/if}}
Address them naturally by name when appropriate, creating a warm and personalized experience...
```

#### More Advanced Example:

```
You are Hon, a creative AI assistant who helps users bring their stories to life.

{{#if user_name}}
You're currently working with {{user_name}}. Welcome them warmly by name at the start of your conversation, 
and use their name naturally throughout to create a personalized, friendly experience.
{{else}}
The user hasn't set a name yet. You can still be friendly and helpful without using their name.
{{/if}}

Your goal is to inspire creativity, provide expert guidance on comic creation, and make the 
entire process feel collaborative and exciting...
```

### Step 3: Conditional Logic (Optional)

Hume supports Handlebars-style conditional logic:

```handlebars
{{#if user_name}}
  Welcome back, {{user_name}}! Ready to create something amazing?
{{else}}
  Welcome! I'm Hon, your creative AI companion.
{{/if}}
```

This ensures Hon behaves appropriately even for users who haven't set their first name yet.

### Step 4: Save Configuration

After updating the prompt:
1. Click "Save" in the Hume dashboard
2. The changes will take effect immediately for new connections
3. No code changes or deployment needed!

## Implementation Details

### Session Variables Passed

The code automatically passes these variables when connecting to Hon:

```typescript
sessionSettings: {
  variables: {
    user_name: userFirstName || userName,        // "Sarah" or "sarah_dev"
    user_first_name: userFirstName,              // "Sarah"
    user_username: userName                       // "sarah_dev"
  }
}
```

**Priority:**
1. If `first_name` is set → uses that
2. If only `username` exists → falls back to username
3. If neither exists → variables are empty strings

### Profile Data Sources

The app fetches from the `profiles` table:

| Database Field | Variable Name | Example Value |
|---------------|---------------|---------------|
| `first_name` | `user_first_name` | "Sarah" |
| `username` | `user_username` | "sarah_dev" |
| `display_name` | Used in `user_username` fallback | "Sarah Developer" |

### Code Location

**File:** `src/services/humeEviService.ts`

**Lines 477-522:**
```typescript
// Fetch profile from Supabase for personalization
const { data } = await supabase
  .from('profiles')
  .select('first_name, username, display_name')
  .eq('id', userId)
  .maybeSingle();

if (data) {
  userFirstName = data.first_name || '';
  userName = data.username || data.display_name || '';
}

// Pass to Hume as session settings
connectOptions.sessionSettings = {
  variables: {
    user_name: userFirstName || userName,
    user_first_name: userFirstName,
    user_username: userName
  }
};
```

## User Experience

### Scenario 1: User with First Name

**Profile:**
- `first_name`: "Sarah"
- `username`: "sarah_dev"

**Hon's Greeting:**
> "Hey Sarah! I'm Hon, your creative AI companion. What story are we bringing to life today?"

### Scenario 2: User with Only Username

**Profile:**
- `first_name`: (empty)
- `username`: "comic_creator_42"

**Hon's Greeting:**
> "Hey comic_creator_42! Ready to create something amazing?"

### Scenario 3: User Without Name

**Profile:**
- `first_name`: (empty)
- `username`: (empty)

**Hon's Greeting:**
> "Hey there! I'm Hon, your creative AI companion. Let's make some incredible comics together!"

## Testing

### Test Personalization

1. **Set your first name** in the profile edit page
2. **Start a conversation** with Hon
3. **Listen for your name** in Hon's greeting
4. **Check console logs** for personalization confirmation:
   ```
   [Hon] Loaded user profile for personalization: { userFirstName: 'Sarah', userName: 'sarah_dev' }
   [Hon] Personalizing session for: Sarah
   ```

### Test Without Name

1. **Clear your first name** in profile settings
2. **Start a conversation** with Hon
3. **Hon should still work** but without using your name
4. **Greeting should adapt** based on your prompt configuration

### Test Session Resume

1. **Have a conversation** with Hon (with your name set)
2. **Wait for inactivity timeout** (or disconnect)
3. **Reconnect** - Hon should still know your name
4. **No repeated introductions** needed

## Troubleshooting

### Issue: Hon not using my name

**Check:**
1. Is `first_name` set in your profile? (Edit Profile page)
2. Is the system prompt updated with `{{user_name}}`?
3. Check console for personalization logs
4. Verify variables are being passed (browser DevTools → Network → WebSocket → Connection query)

**Debug:**
```typescript
// Add to browser console
const state = useComicStore.getState();
console.log('User ID:', state.user?.id);

// Check Supabase directly
const { data } = await supabase
  .from('profiles')
  .select('first_name')
  .eq('id', 'YOUR_USER_ID')
  .single();
console.log('First name in DB:', data?.first_name);
```

### Issue: Variables not appearing in prompt

**Verify:**
- Hume dashboard configuration is saved
- Using correct syntax: `{{user_name}}` (double curly braces)
- No typos in variable names
- Configuration ID matches the one in your code

### Issue: Name appears but feels unnatural

**Improve the prompt:**
- Don't force Hon to use name in every sentence
- Use conditional logic: `{{#if user_name}}Welcome back, {{user_name}}!{{/if}}`
- Instruct Hon to use name "naturally" rather than repeatedly
- Example: "Use their name occasionally to maintain warmth, but don't overdo it"

## Best Practices

### ✅ Do:
- Use conditional logic for graceful fallbacks
- Fetch profile data early (before connecting)
- Log personalization for debugging
- Instruct Hon to use name "naturally"
- Test with and without names set

### ❌ Don't:
- Hard-code names in the prompt
- Force Hon to use name in every response
- Forget about users without names
- Use sensitive data beyond first name
- Store names in localStorage (use database)

## Privacy Considerations

### What We Send to Hume:
- ✅ First name (user-provided, non-sensitive)
- ✅ Username (public identifier)
- ❌ Email addresses (never sent)
- ❌ Wallet addresses (never sent)
- ❌ Last names (never sent)
- ❌ Any other PII

### User Control:
- Users can set/update their first name anytime
- Leaving first name blank is totally fine
- No name = Hon still works perfectly
- Name is only used for personalization, not identification

## Future Enhancements

### Potential Additions:

1. **Preferences**: Pass user preferences as variables
   ```typescript
   preferred_style: "anime",
   favorite_model: "Flux Dev",
   typical_workflow: "storyboard-first"
   ```

2. **Session Context**: Include creative stats
   ```typescript
   comics_created: 12,
   favorite_genre: "sci-fi",
   last_active: "2 days ago"
   ```

3. **Team Context**: For collaborative workflows
   ```typescript
   team_name: "Cosmic Studios",
   role: "Lead Artist",
   collaborators: ["Alice", "Bob"]
   ```

4. **Language Preference**: Auto-detect or user-set
   ```typescript
   language: "en",
   locale: "en-US"
   ```

## Related Documentation

- [Hume EVI Session Settings](https://dev.hume.ai/reference/speech-to-speech-evi/chat)
- [Handlebars Template Syntax](https://handlebarsjs.com/guide/)
- [Hon Session Management](./hon-session-management.md)

---

**Ready to personalize?** Update your Hume prompt with `{{user_name}}` and watch Hon create magical, personalized experiences! ✨

