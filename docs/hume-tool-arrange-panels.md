# Hume Dashboard Tool Configuration: arrange_panels

## Tool Name
`arrange_panels`

## Description
Arranges panels in board mode into different layout patterns. Use this when the user wants to organize or rearrange panels visually on the canvas.

## Parameters Schema

```json
{
  "type": "object",
  "properties": {
    "layout_type": {
      "type": "string",
      "enum": ["grid", "timeline", "storyboard", "cluster"],
      "description": "The layout pattern to arrange panels into. 'grid' arranges panels in a centered 3-column grid. 'timeline' arranges panels horizontally in chronological order. 'storyboard' arranges panels in a traditional 2-row grid layout. 'cluster' arranges panels in a grouped layout with organic spacing."
    }
  },
  "required": ["layout_type"]
}
```

## Example User Phrases That Should Trigger This Tool

- "organize panels into a cluster"
- "position panels in a timeline"
- "arrange panels in grid"
- "organize panels into a storyboard"
- "put panels in a grid layout"
- "arrange panels horizontally"
- "cluster the panels"
- "make a timeline layout"
- "organize into storyboard format"

## Implementation Notes

- The tool dispatches custom DOM events that are handled by the Creator component
- Events dispatched: `board-arrange-grid`, `board-arrange-timeline`, `board-arrange-storyboard`, `board-arrange-cluster`
- Only works when in board mode (when zoomed out)
- Automatically fits the view after arranging panels

