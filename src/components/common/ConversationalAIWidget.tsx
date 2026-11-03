import React from 'react';

interface ConversationalAIWidgetProps {
  position: 'bottom-left' | 'bottom-right' | 'side';
  className?: string;
}

// The ElevenLabs Conversational AI widget is not available in this build: the
// page script policy (csp.config.js) does not allow its script host, and no
// agent is configured. The component used to inject that script with a fixed
// agent ID, which always failed silently. It now renders nothing; Hon's voice
// comes from Hume EVI.
export const ConversationalAIWidget: React.FC<ConversationalAIWidgetProps> = () => null;
