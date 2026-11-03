# PlayCanvas PCUI - Comprehensive Analysis for Scene Editors

## Overview

PlayCanvas PCUI is a production-ready UI component library specifically designed for editor interfaces. It powers the PlayCanvas Editor, SuperSplat, Model Viewer, and Texture Tool. The library provides a complete solution for building scene editors with hierarchical views, property panels, and data binding.

**Key Technologies:**
- TypeScript (80.3%)
- SCSS (16.0%)
- React support with vanilla JS core
- @playcanvas/observer for reactive data binding

**Installation:**
```bash
npm install @playcanvas/pcui --save-dev
npm install @playcanvas/observer
```

---

## 1. UI Component Architecture

### Base Class Hierarchy

PCUI uses a hierarchical component system:

```
Events (base event system)
  └── Element (base UI element)
      ├── Container (layout container)
      │   ├── Panel (collapsible panels)
      │   ├── GridView (grid layouts)
      │   ├── TreeView (hierarchies)
      │   └── Overlay (modals/popups)
      └── InputElement (base for inputs)
          ├── NumericInput
          ├── TextInput
          ├── VectorInput
          ├── SelectInput
          └── SliderInput
```

### Element Base Class

The `Element` class is the foundation of all PCUI components:

**Core Features:**
- DOM management with underlying HTMLElement
- Parent-child hierarchical relationships
- State management (enabled, hidden, readonly, error)
- Event system (enable, disable, hide, show, click, hover)
- Data binding integration via BindingBase
- CSS flexbox property accessors

**Key Properties:**
```typescript
interface ElementArgs {
    dom?: string | HTMLElement;          // Element or tag name
    binding?: BindingBase;               // Data binding configuration
    parent?: Element;                    // Parent element
    class?: string | string[];           // CSS classes
    enabled?: boolean;                   // Enabled state
    hidden?: boolean;                    // Visibility
    readOnly?: boolean;                  // Read-only state
    onClick?: (evt: MouseEvent) => void; // Click handler
    onChange?: (value: any) => void;     // Change handler
    onRemove?: () => void;               // Remove handler
}
```

**Static Registry System:**
```typescript
// Register custom element types
Element.register('mycomponent', MyComponent);

// Factory method for creating registered types
const element = Element.create('mycomponent', args);
```

**Hierarchical State Management:**
```typescript
class Element {
    // Enabled state cascades from parent
    get enabled(): boolean {
        if (this._ignoreParent) return this._enabled;
        return this._enabled &&
               (!this._parent || this._parent.enabled);
    }

    // Hidden state with parent chain consideration
    get hiddenToRoot(): boolean {
        if (this._hidden) return true;
        return this._parent ? this._parent.hiddenToRoot : false;
    }
}
```

### Container Class

The `Container` extends `Element` and provides layout and child management:

**Layout Support:**
- Flexbox layout
- Grid layout
- Scrollable content areas

**Resize Functionality:**
- Configurable resize handles (top, bottom, right, left)
- Min/max size constraints
- Pointer-based resize events

**Child Management:**
```typescript
// Append, prepend, and remove children
container.append(child);
container.prepend(child);
container.remove(child);

// Insert relative to reference
container.insertBefore(child, referenceElement);
container.insertAfter(child, referenceElement);

// Clear all children
container.clear();

// Iterate over children
container.forEachChild((child) => {
    console.log(child);
});
```

**Events:**
- `EVENT_APPEND`: Fires when elements are added
- `EVENT_REMOVE`: Fires when elements are removed
- `EVENT_SCROLL`: Fires on scroll
- `EVENT_RESIZE`: Fires when resized

**Drag & Drop for Reordering:**
```typescript
const container = new Container({
    dom: 'div',
    // Enable drag-drop reordering
});

container.on('append', (element) => {
    // Handle child addition
});
```

**Building DOM Declaratively:**
```typescript
container.buildDom([
    {
        element: new Label({ text: 'Name:' }),
        flex: true
    },
    {
        element: new TextInput(),
        flex: true
    }
]);
```

---

## 2. Data Binding Patterns

### The Observer System

PCUI integrates with `@playcanvas/observer` for reactive data binding. The Observer pattern allows automatic synchronization between data models and UI components.

**Basic Observer Usage:**
```javascript
import { Observer } from '@playcanvas/observer';

const observer = new Observer({
    position: { x: 0, y: 5, z: 10 },
    rotation: { x: 0, y: 90, z: 0 },
    name: 'Player',
    health: 100
});

// Listen to changes
observer.on('position.x:set', (newValue, oldValue) => {
    console.log(`X changed from ${oldValue} to ${newValue}`);
});

// Update values
observer.set('position.x', 15); // Triggers the event
```

### Binding Classes

PCUI provides three binding strategies:

1. **BindingObserversToElement** - One-way: Observer → UI
2. **BindingElementToObservers** - One-way: UI → Observer
3. **BindingTwoWay** - Bidirectional synchronization

### One-Way Binding: Observer to Element

Use when the UI should display data but not modify it (e.g., readonly labels):

```javascript
import { Observer } from '@playcanvas/observer';
import { Label, BindingObserversToElement } from '@playcanvas/pcui';

const observer = new Observer({
    playerName: 'John Doe'
});

const label = new Label({
    binding: new BindingObserversToElement()
});

// Link to observer property
label.link(observer, 'playerName');

// When observer changes, label updates automatically
observer.set('playerName', 'Jane Smith'); // Label text updates
```

### One-Way Binding: Element to Observer

Use when UI should update data but not reflect external changes:

```javascript
import { Observer } from '@playcanvas/observer';
import { TextInput, BindingElementToObservers } from '@playcanvas/pcui';

const observer = new Observer({
    searchQuery: ''
});

const input = new TextInput({
    binding: new BindingElementToObservers()
});

input.link(observer, 'searchQuery');

// User typing updates observer
// But external changes to observer don't update the input
```

### Two-Way Binding

Use for fully synchronized UI controls (most common pattern):

```javascript
import { Observer } from '@playcanvas/observer';
import { TextInput, NumericInput, BindingTwoWay } from '@playcanvas/pcui';

const observer = new Observer({
    entityName: 'Light',
    intensity: 1.5
});

// Create multiple inputs bound to the same data
const nameInput1 = new TextInput({
    binding: new BindingTwoWay()
});
nameInput1.link(observer, 'entityName');

const nameInput2 = new TextInput({
    binding: new BindingTwoWay()
});
nameInput2.link(observer, 'entityName');

// Both inputs stay synchronized
// Typing in either input updates both + the observer
```

### Binding Arrays and Nested Objects

**Vector Binding:**
```javascript
const observer = new Observer({
    position: [10, 20, 30]
});

const vectorInput = new VectorInput({
    dimensions: 3,
    binding: new BindingTwoWay()
});

// Link individual components
vectorInput.link(observer, 'position');

// Internally links to position.0, position.1, position.2
```

**Array Binding:**
```javascript
const observer = new Observer({
    materials: ['metal', 'glass', 'wood']
});

const arrayInput = new ArrayInput({
    type: 'string',
    binding: new BindingTwoWay()
});

arrayInput.link(observer, 'materials');
```

### Binding History Integration

PCUI bindings support history tracking for undo/redo:

```javascript
const binding = new BindingTwoWay({
    history: true,  // Enable history tracking
    historyName: 'Entity Position',  // Name for undo stack
    historyPrefix: 'entity.transform',  // Path prefix
    historyCombine: false  // Don't combine sequential edits
});

const input = new NumericInput({ binding });
input.link(observer, 'position.x');

// Changes are automatically tracked for undo/redo
```

---

## 3. Tree/Hierarchy Views

### TreeView Component

The `TreeView` component provides a fully-featured hierarchical tree with drag-drop, selection, filtering, and renaming.

**Core Features:**
- Multi-select with Ctrl/Shift modifiers
- Drag & drop reordering
- Keyboard navigation (arrow keys)
- Inline renaming
- Search filtering
- Collapsible nodes

**Basic Usage:**
```javascript
import { TreeView, TreeViewItem } from '@playcanvas/pcui';

const treeView = new TreeView({
    allowDrag: true,
    allowReordering: true,
    allowRenaming: true
});

// Create root node
const root = new TreeViewItem({
    text: 'Scene',
    icon: 'E229',  // Icon code
    open: true     // Expanded by default
});

treeView.append(root);

// Add children
const camera = new TreeViewItem({
    text: 'Main Camera',
    icon: 'E139'
});
root.append(camera);

const light = new TreeViewItem({
    text: 'Directional Light',
    icon: 'E208'
});
root.append(light);

document.body.appendChild(treeView.dom);
```

**Advanced Example - Scene Hierarchy:**
```javascript
// Create scene hierarchy
const sceneTree = new TreeView({
    allowDrag: true,
    allowReordering: true,
    allowRenaming: true,
    onReparent: (item, newParent) => {
        // Custom reparenting logic
        console.log(`Moving ${item.text} to ${newParent.text}`);
        return true; // Allow reparent
    }
});

// Recursively generate hierarchy
function createEntityNode(entity, parent) {
    const node = new TreeViewItem({
        text: entity.name,
        icon: getIconForType(entity.type),
        allowDrop: true,
        allowDrag: true,
        open: entity.expanded
    });

    if (parent) {
        parent.append(node);
    } else {
        sceneTree.append(node);
    }

    // Add children
    entity.children.forEach(child => {
        createEntityNode(child, node);
    });

    return node;
}

// Build tree from data
const sceneData = {
    name: 'Root',
    type: 'entity',
    expanded: true,
    children: [
        {
            name: 'Camera',
            type: 'camera',
            children: []
        },
        {
            name: 'Lights',
            type: 'folder',
            children: [
                { name: 'Sun', type: 'light', children: [] },
                { name: 'Fill', type: 'light', children: [] }
            ]
        }
    ]
};

createEntityNode(sceneData);
```

### TreeViewItem Component

Individual tree nodes with rich functionality:

**Properties:**
```typescript
interface TreeViewItemArgs {
    text?: string;           // Display text
    icon?: string;           // Icon code (e.g., 'E229')
    allowSelect?: boolean;   // Can be selected
    allowDrop?: boolean;     // Can accept drops
    allowDrag?: boolean;     // Can be dragged
    open?: boolean;          // Expanded state
}
```

**Key Methods:**
```javascript
// Selection
item.selected = true;
const isSelected = item.selected;

// Text
item.text = 'New Name';
item.rename(); // Enable inline editing

// Icon
item.icon = 'E139';

// Expansion
item.open = true;
item.open = false;

// Focus
item.focus();

// Navigation
const next = item.nextSibling;
const prev = item.previousSibling;
const first = item.firstChild;
const last = item.lastChild;
const count = item.numChildren;

// Parent visibility
item.parentsOpen = true; // Ensure all parents are expanded
```

### TreeView Selection Management

```javascript
const treeView = new TreeView();

// Get selected items
const selected = treeView.selected;

// Deselect all
treeView.deselect();

// Selection events
treeView.on('select', (item) => {
    console.log('Selected:', item.text);
});

treeView.on('deselect', (item) => {
    console.log('Deselected:', item.text);
});
```

### TreeView Drag & Drop

```javascript
const treeView = new TreeView({
    allowDrag: true,
    allowReordering: true
});

// Drag events
treeView.on('dragstart', (items) => {
    console.log('Started dragging:', items.map(i => i.text));
});

treeView.on('reparent', (item, oldParent, newParent) => {
    console.log(`Moved ${item.text} from ${oldParent.text} to ${newParent.text}`);

    // Update your data model here
    updateSceneGraph(item, newParent);
});

treeView.on('dragend', () => {
    console.log('Drag ended');
});
```

### TreeView Filtering

```javascript
const treeView = new TreeView();

// Set filter function
treeView.filter = (item) => {
    // Show only items containing search term
    const searchTerm = searchInput.value.toLowerCase();
    return item.text.toLowerCase().includes(searchTerm);
};

// Clear filter
treeView.clearFilter();
```

### TreeView Keyboard Navigation

Built-in keyboard support:
- **Up/Down arrows**: Navigate between visible items
- **Left arrow**: Collapse expanded item or move to parent
- **Right arrow**: Expand collapsed item or move to first child
- **Enter**: Start renaming (if allowRenaming is true)
- **Escape**: Cancel rename
- **Ctrl/Cmd + Click**: Multi-select toggle
- **Shift + Click**: Range selection

---

## 4. Property Panels and Inspectors

### Panel Component

Collapsible panel containers ideal for inspector sections:

**Basic Panel:**
```javascript
import { Panel, LabelGroup, TextInput, NumericInput } from '@playcanvas/pcui';

const panel = new Panel({
    headerText: 'Transform',
    collapsible: true,
    collapsed: false,
    removable: false
});

// Add properties
panel.append(new LabelGroup({
    text: 'Position X',
    field: new NumericInput({ value: 0 })
}));

panel.append(new LabelGroup({
    text: 'Position Y',
    field: new NumericInput({ value: 0 })
}));

panel.append(new LabelGroup({
    text: 'Position Z',
    field: new NumericInput({ value: 0 })
}));

document.body.appendChild(panel.dom);
```

**Panel with Binding:**
```javascript
import { Observer } from '@playcanvas/observer';
import { Panel, LabelGroup, VectorInput, BindingTwoWay } from '@playcanvas/pcui';

const entityObserver = new Observer({
    name: 'Cube',
    position: [0, 5, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1]
});

// Transform panel
const transformPanel = new Panel({
    headerText: 'Transform',
    collapsible: true
});

// Position
const positionInput = new VectorInput({
    dimensions: 3,
    precision: 2,
    step: 0.1,
    binding: new BindingTwoWay()
});
positionInput.link(entityObserver, 'position');

transformPanel.append(new LabelGroup({
    text: 'Position',
    field: positionInput
}));

// Rotation
const rotationInput = new VectorInput({
    dimensions: 3,
    precision: 1,
    step: 1,
    binding: new BindingTwoWay()
});
rotationInput.link(entityObserver, 'rotation');

transformPanel.append(new LabelGroup({
    text: 'Rotation',
    field: rotationInput
}));

// Scale
const scaleInput = new VectorInput({
    dimensions: 3,
    precision: 2,
    step: 0.1,
    binding: new BindingTwoWay()
});
scaleInput.link(entityObserver, 'scale');

transformPanel.append(new LabelGroup({
    text: 'Scale',
    field: scaleInput
}));
```

**Panel Events:**
```javascript
panel.on('collapse', () => {
    console.log('Panel collapsed');
});

panel.on('expand', () => {
    console.log('Panel expanded');
});

panel.on('click:remove', () => {
    console.log('Remove button clicked');
    panel.destroy();
});
```

**Collapsible Panel Configuration:**
```javascript
const panel = new Panel({
    headerText: 'Component',
    collapsible: true,
    collapsed: false,
    collapseHorizontally: false,  // Vertical collapse
    headerSize: 32                // Header height in pixels
});

// Programmatic control
panel.collapsed = true;
panel.collapsed = false;
```

**Sortable Panels:**
```javascript
const panel = new Panel({
    headerText: 'Layer 1',
    sortable: true
});

panel.on('dragstart', () => {
    console.log('Started dragging panel');
});

panel.on('dragmove', (x, y) => {
    console.log('Dragging at:', x, y);
});

panel.on('dragend', () => {
    console.log('Drag ended');
});
```

### LabelGroup Component

Combines a label with an input field for property rows:

```javascript
import { LabelGroup, NumericInput, BooleanInput, SelectInput } from '@playcanvas/pcui';

// Numeric property
const intensityGroup = new LabelGroup({
    text: 'Intensity',
    field: new NumericInput({
        min: 0,
        max: 10,
        precision: 2,
        step: 0.1
    })
});

// Boolean property
const enabledGroup = new LabelGroup({
    text: 'Enabled',
    field: new BooleanInput({ value: true })
});

// Select property
const typeGroup = new LabelGroup({
    text: 'Type',
    field: new SelectInput({
        options: [
            { t: 'Point', v: 'point' },
            { t: 'Directional', v: 'directional' },
            { t: 'Spot', v: 'spot' }
        ],
        value: 'point'
    })
});

// Label alignment
const group = new LabelGroup({
    text: 'Property',
    field: new TextInput(),
    labelAlignTop: true  // Align label to top instead of center
});
```

### Complete Inspector Example

```javascript
import { Observer } from '@playcanvas/observer';
import {
    Container, Panel, LabelGroup,
    TextInput, NumericInput, VectorInput,
    BooleanInput, SelectInput, ColorPicker,
    BindingTwoWay
} from '@playcanvas/pcui';

class EntityInspector {
    constructor(entity) {
        this.observer = new Observer(entity);
        this.container = new Container({ flex: true });

        this._buildUI();
    }

    _buildUI() {
        // Entity panel
        const entityPanel = this._createEntityPanel();
        this.container.append(entityPanel);

        // Transform panel
        const transformPanel = this._createTransformPanel();
        this.container.append(transformPanel);

        // Component panels
        if (this.observer.get('components.light')) {
            const lightPanel = this._createLightPanel();
            this.container.append(lightPanel);
        }

        if (this.observer.get('components.model')) {
            const modelPanel = this._createModelPanel();
            this.container.append(modelPanel);
        }
    }

    _createEntityPanel() {
        const panel = new Panel({
            headerText: 'Entity',
            collapsible: true
        });

        // Name
        const nameInput = new TextInput({
            binding: new BindingTwoWay()
        });
        nameInput.link(this.observer, 'name');

        panel.append(new LabelGroup({
            text: 'Name',
            field: nameInput
        }));

        // Enabled
        const enabledInput = new BooleanInput({
            binding: new BindingTwoWay()
        });
        enabledInput.link(this.observer, 'enabled');

        panel.append(new LabelGroup({
            text: 'Enabled',
            field: enabledInput
        }));

        return panel;
    }

    _createTransformPanel() {
        const panel = new Panel({
            headerText: 'Transform',
            collapsible: true
        });

        // Position
        const positionInput = new VectorInput({
            dimensions: 3,
            precision: 2,
            binding: new BindingTwoWay()
        });
        positionInput.link(this.observer, 'position');

        panel.append(new LabelGroup({
            text: 'Position',
            field: positionInput
        }));

        // Rotation
        const rotationInput = new VectorInput({
            dimensions: 3,
            precision: 1,
            binding: new BindingTwoWay()
        });
        rotationInput.link(this.observer, 'rotation');

        panel.append(new LabelGroup({
            text: 'Rotation',
            field: rotationInput
        }));

        // Scale
        const scaleInput = new VectorInput({
            dimensions: 3,
            precision: 2,
            binding: new BindingTwoWay()
        });
        scaleInput.link(this.observer, 'scale');

        panel.append(new LabelGroup({
            text: 'Scale',
            field: scaleInput
        }));

        return panel;
    }

    _createLightPanel() {
        const panel = new Panel({
            headerText: 'Light Component',
            collapsible: true,
            removable: true
        });

        // Type
        const typeInput = new SelectInput({
            options: [
                { t: 'Directional', v: 'directional' },
                { t: 'Point', v: 'point' },
                { t: 'Spot', v: 'spot' }
            ],
            binding: new BindingTwoWay()
        });
        typeInput.link(this.observer, 'components.light.type');

        panel.append(new LabelGroup({
            text: 'Type',
            field: typeInput
        }));

        // Color
        const colorInput = new ColorPicker({
            binding: new BindingTwoWay()
        });
        colorInput.link(this.observer, 'components.light.color');

        panel.append(new LabelGroup({
            text: 'Color',
            field: colorInput
        }));

        // Intensity
        const intensityInput = new NumericInput({
            min: 0,
            max: 10,
            precision: 2,
            binding: new BindingTwoWay()
        });
        intensityInput.link(this.observer, 'components.light.intensity');

        panel.append(new LabelGroup({
            text: 'Intensity',
            field: intensityInput
        }));

        return panel;
    }

    _createModelPanel() {
        const panel = new Panel({
            headerText: 'Model Component',
            collapsible: true,
            removable: true
        });

        // Cast Shadows
        const castShadowsInput = new BooleanInput({
            binding: new BindingTwoWay()
        });
        castShadowsInput.link(this.observer, 'components.model.castShadows');

        panel.append(new LabelGroup({
            text: 'Cast Shadows',
            field: castShadowsInput
        }));

        // Receive Shadows
        const receiveShadowsInput = new BooleanInput({
            binding: new BindingTwoWay()
        });
        receiveShadowsInput.link(this.observer, 'components.model.receiveShadows');

        panel.append(new LabelGroup({
            text: 'Receive Shadows',
            field: receiveShadowsInput
        }));

        return panel;
    }

    get dom() {
        return this.container.dom;
    }
}

// Usage
const entity = {
    name: 'Cube',
    enabled: true,
    position: [0, 5, 0],
    rotation: [0, 45, 0],
    scale: [1, 1, 1],
    components: {
        light: {
            type: 'point',
            color: [255, 255, 255],
            intensity: 1.0
        },
        model: {
            castShadows: true,
            receiveShadows: true
        }
    }
};

const inspector = new EntityInspector(entity);
document.body.appendChild(inspector.dom);
```

---

## 5. Input Components

### NumericInput

Numeric input with slider, math expression support, and precision control:

```javascript
import { NumericInput } from '@playcanvas/pcui';

const input = new NumericInput({
    min: 0,
    max: 100,
    precision: 2,      // Decimal places
    step: 1,           // Arrow key increment
    stepPrecision: 10, // Shift+arrow increment
    hideSlider: false, // Show drag slider
    allowNull: false,  // Permit null values
    placeholder: 'Enter value'
});

// Math expressions
input.value = '10 + 20';  // Evaluates to 30
input.value = '5 * 6';    // Evaluates to 30
input.value = '100 / 4';  // Evaluates to 25

// Slider interaction
// Drag on the input to adjust value smoothly
// Mouse wheel also adjusts value

// Events
input.on('change', (value) => {
    console.log('Value changed:', value);
});
```

### VectorInput

Multi-dimensional vector input (2D, 3D, 4D):

```javascript
import { VectorInput } from '@playcanvas/pcui';

// 3D Vector
const vec3Input = new VectorInput({
    dimensions: 3,
    min: -100,
    max: 100,
    precision: 2,
    step: 0.1,
    placeholder: ['X', 'Y', 'Z']
});

vec3Input.value = [10, 20, 30];

// Alt+Drag to bind all inputs together
// (all dimensions change with single value)

// Pre-configured variants
Element.create('vec2', { value: [0, 0] });
Element.create('vec3', { value: [0, 0, 0] });
Element.create('vec4', { value: [0, 0, 0, 1] });

// Events
vec3Input.on('change', (value) => {
    console.log('Vector changed:', value); // [x, y, z]
});

// With Observer binding
const observer = new Observer({ position: [0, 0, 0] });
vec3Input.link(observer, 'position');
```

### SelectInput

Dropdown select with search, multi-select, and tag creation:

```javascript
import { SelectInput } from '@playcanvas/pcui';

// Basic select
const select = new SelectInput({
    options: [
        { t: 'Option 1', v: 1 },
        { t: 'Option 2', v: 2 },
        { t: 'Option 3', v: 3 }
    ],
    value: 1,
    type: 'number'  // or 'string', 'boolean'
});

// Multi-select
const multiSelect = new SelectInput({
    multiSelect: true,
    options: [
        { t: 'Red', v: 'red' },
        { t: 'Green', v: 'green' },
        { t: 'Blue', v: 'blue' }
    ],
    value: ['red', 'blue']
});

// Searchable with custom values
const tags = new SelectInput({
    allowInput: true,    // Enable search
    allowCreate: true,   // Allow creating new options
    multiSelect: true,
    options: [
        { t: 'Tag 1', v: 'tag1' },
        { t: 'Tag 2', v: 'tag2' }
    ]
});

// Pre-configured variants
Element.create('select', { options: [...] });
Element.create('multiselect', { options: [...] });
Element.create('tags', { options: [...] });

// Events
select.on('change', (value) => {
    console.log('Selected:', value);
});

// Programmatic control
select.open();
select.close();
select.toggle();
```

### SliderInput

Numeric input combined with slider:

```javascript
import { SliderInput } from '@playcanvas/pcui';

const slider = new SliderInput({
    sliderMin: 0,
    sliderMax: 100,
    min: 0,         // Input min
    max: 100,       // Input max
    precision: 0,
    step: 1,
    value: 50
});

// Combines NumericInput with visual slider
// Drag on slider bar to adjust
// Arrow keys also work

slider.on('change', (value) => {
    console.log('Slider value:', value);
});
```

### BooleanInput

Checkbox input:

```javascript
import { BooleanInput } from '@playcanvas/pcui';

const checkbox = new BooleanInput({
    value: true
});

checkbox.on('change', (value) => {
    console.log('Checked:', value);
});
```

### TextInput & TextAreaInput

```javascript
import { TextInput, TextAreaInput } from '@playcanvas/pcui';

// Single-line text
const textInput = new TextInput({
    placeholder: 'Enter name...',
    value: 'Initial value',
    blurOnEnter: true,    // Blur when Enter pressed
    blurOnEscape: true,   // Blur when Escape pressed
    keyChange: false      // Trigger change on keyup
});

// Multi-line text
const textArea = new TextAreaInput({
    placeholder: 'Description...',
    value: 'Multi-line\ntext here'
});

textInput.on('change', (value) => {
    console.log('Text changed:', value);
});
```

### ColorPicker

Interactive color picker with HSV selector and RGB/hex inputs:

```javascript
import { ColorPicker } from '@playcanvas/pcui';

// RGB color
const colorPicker = new ColorPicker({
    channels: 3,  // RGB
    value: [255, 128, 0]
});

// RGBA with alpha
const colorPickerAlpha = new ColorPicker({
    channels: 4,  // RGBA
    value: [255, 128, 0, 128]
});

// Events
colorPicker.on('change', (value) => {
    console.log('Color:', value); // [r, g, b]
});

colorPicker.on('picker:color:start', () => {
    console.log('Started picking color');
});

colorPicker.on('picker:color:end', () => {
    console.log('Finished picking color');
});

// The picker overlay shows:
// - Rectangular saturation/value picker
// - Hue slider
// - Opacity slider (if channels === 4)
// - RGB input fields
// - Hex input field
```

### ArrayInput

Dynamic array editor with add/remove functionality:

```javascript
import { ArrayInput } from '@playcanvas/pcui';

// Array of strings
const stringArray = new ArrayInput({
    type: 'string',
    value: ['item1', 'item2', 'item3']
});

// Array of numbers
const numberArray = new ArrayInput({
    type: 'number',
    value: [1, 2, 3, 4, 5],
    fixedSize: false  // Allow resizing
});

// Array of vectors
const vectorArray = new ArrayInput({
    type: 'vec3',
    value: [[0, 0, 0], [1, 1, 1]],
    getDefaultFn: () => [0, 0, 0]  // Default for new items
});

// With panels for each item
const panelArray = new ArrayInput({
    type: 'number',
    usePanels: true,
    value: [10, 20, 30]
});

// Events
numberArray.on('change', (value) => {
    console.log('Array:', value);
});

// Supported types
Element.create('array:string', { value: [] });
Element.create('array:number', { value: [] });
Element.create('array:boolean', { value: [] });
Element.create('array:vec2', { value: [] });
Element.create('array:vec3', { value: [] });
Element.create('array:vec4', { value: [] });
```

---

## 6. GridView Component

Grid layout for asset browsers and icon grids:

```javascript
import { GridView, GridViewItem } from '@playcanvas/pcui';

const gridView = new GridView({
    multiSelect: true,       // Allow multiple selection
    allowDeselect: true,     // Can deselect when multiSelect=false
    vertical: false          // Horizontal wrapping grid
});

// Add items
for (let i = 0; i < 20; i++) {
    const item = new GridViewItem({
        text: `Item ${i}`,
        icon: 'E229'
    });
    gridView.append(item);
}

// Selection
gridView.on('select', (item) => {
    console.log('Selected:', item.text);
});

const selected = gridView.selected; // Array of selected items
gridView.deselect(); // Clear all selections

// Filtering
gridView.filter = (item) => {
    return item.text.includes('search term');
};

// Async filtering for large datasets
gridView.filterAsync(100); // Process 100 items per batch

gridView.on('filter:start', () => {
    console.log('Filtering started');
});

gridView.on('filter:end', () => {
    console.log('Filtering completed');
});

// Cancel async filtering
gridView.filterAsyncCancel();

document.body.appendChild(gridView.dom);
```

---

## 7. Styling System

### Theme Architecture

PCUI uses a modular SCSS architecture with theme support:

```
src/scss/
├── _common.scss              # Common utilities
├── _components.scss          # Component styles
├── _fonts.scss              # Typography
├── _icons.scss              # Icon styles
├── _variables-common.scss   # Shared variables
├── _variables-green.scss    # Green theme
├── _variables-grey.scss     # Grey theme
├── pcui-theme-green.scss    # Green theme output
└── pcui-theme-grey.scss     # Grey theme output
```

### Common Variables

```scss
// Spacing
$field-padding: 3px;
$element-margin: 6px;

// Opacity states
$disabled-opacity: 0.4;
$element-opacity-disabled: 0.4;
$element-opacity-readonly: 0.7;
```

### Grey Theme Variables

```scss
$text-darkest: rgb(170 170 170 / 50%);
$text-dark: rgb(170 170 170 / 50%);
$text-secondary: #aaa;
$element-color-placeholder: #829193;
$border-primary: #aaa;
```

### Using Themes

```javascript
// Import grey theme
import '@playcanvas/pcui/styles';  // Default

// Or import specific theme
import '@playcanvas/pcui/styles/pcui-theme-grey.css';
import '@playcanvas/pcui/styles/pcui-theme-green.css';
```

### Custom Fonts

Override the default fonts with custom typefaces:

```css
.font-regular {
    font-family: 'Your Font', sans-serif;
}

.font-bold {
    font-family: 'Your Font Bold', sans-serif;
    font-weight: bold;
}

.font-thin {
    font-family: 'Your Font Thin', sans-serif;
    font-weight: 300;
}

.font-light {
    font-family: 'Your Font Light', sans-serif;
    font-weight: 400;
}
```

### Component-Specific Styling

**TreeView:**
```scss
.pcui-treeview {
    min-width: max-content;
}

.pcui-treeview-item {
    padding-left: 24px;  // Indentation per level
}

.pcui-treeview-item-selected {
    background-color: $background-darkest;
    color: $text-primary;
}

.pcui-treeview-item-icon {
    font-size: 14px;
}
```

**Panel:**
```scss
.pcui-panel-header {
    background-color: $background-dark;
    font-size: 12px;
    height: 32px;
}

.pcui-panel-collapsible .pcui-panel-header {
    cursor: pointer;
}

.pcui-panel-collapsed .pcui-panel-content {
    visibility: hidden;
}
```

**Container:**
```scss
.pcui-container-resizable {
    position: relative;
}

.pcui-container-resizable-handle-right {
    cursor: ew-resize;
    border-right: 3px solid transparent;
}

.pcui-container-resizable-handle-bottom {
    cursor: ns-resize;
    border-bottom: 3px solid transparent;
}
```

### CSS Classes

Common CSS classes applied to elements:

```javascript
// Class constants
CLASS_COLLAPSED = 'pcui-collapsed'
CLASS_DISABLED = 'pcui-disabled'
CLASS_ENABLED = 'pcui-enabled'
CLASS_ERROR = 'pcui-error'
CLASS_FLASH = 'pcui-flash'
CLASS_FOCUS = 'pcui-focus'
CLASS_HIDDEN = 'pcui-hidden'
CLASS_MULTIPLE_VALUES = 'pcui-multiple-values'
CLASS_READONLY = 'pcui-readonly'
```

### Custom Styling Example

```javascript
import { Panel, Container } from '@playcanvas/pcui';
import '@playcanvas/pcui/styles';

const panel = new Panel({
    headerText: 'Custom Styled Panel',
    class: 'my-custom-panel'
});

// Add custom CSS
const style = document.createElement('style');
style.textContent = `
    .my-custom-panel .pcui-panel-header {
        background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
        color: white;
        font-weight: bold;
    }

    .my-custom-panel .pcui-panel-content {
        padding: 16px;
        background-color: #f5f5f5;
    }
`;
document.head.appendChild(style);
```

---

## 8. Advanced Patterns for Scene Editors

### Multi-Selection Inspector

Handle multiple selected entities:

```javascript
import { Observer } from '@playcanvas/observer';
import { Panel, LabelGroup, VectorInput, BindingTwoWay } from '@playcanvas/pcui';

class MultiSelectionInspector {
    constructor() {
        this.observers = [];
        this.container = new Container();
    }

    setSelection(entities) {
        // Clear previous observers
        this.observers = entities.map(e => new Observer(e));
        this._rebuild();
    }

    _rebuild() {
        this.container.clear();

        if (this.observers.length === 0) {
            // No selection
            return;
        }

        if (this.observers.length === 1) {
            // Single selection - full inspector
            this._buildSingleInspector();
        } else {
            // Multi-selection - show common properties only
            this._buildMultiInspector();
        }
    }

    _buildSingleInspector() {
        // Full inspector for single entity
        const panel = new Panel({ headerText: 'Transform' });

        const posInput = new VectorInput({
            dimensions: 3,
            binding: new BindingTwoWay()
        });
        posInput.link(this.observers[0], 'position');

        panel.append(new LabelGroup({
            text: 'Position',
            field: posInput
        }));

        this.container.append(panel);
    }

    _buildMultiInspector() {
        // Multi-selection inspector
        const panel = new Panel({
            headerText: `Transform (${this.observers.length} objects)`
        });

        // Position - linked to all observers
        const posInput = new VectorInput({
            dimensions: 3,
            binding: new BindingTwoWay()
        });

        // Link to all observers
        this.observers.forEach(obs => {
            posInput.link(obs, 'position');
        });

        panel.append(new LabelGroup({
            text: 'Position',
            field: posInput
        }));

        this.container.append(panel);
    }
}
```

### Undo/Redo System Integration

```javascript
import { Observer } from '@playcanvas/observer';
import { NumericInput, BindingTwoWay } from '@playcanvas/pcui';

class UndoManager {
    constructor() {
        this.history = [];
        this.index = -1;
    }

    record(action) {
        // Remove any redo history
        this.history = this.history.slice(0, this.index + 1);

        this.history.push(action);
        this.index++;
    }

    undo() {
        if (this.index < 0) return;

        const action = this.history[this.index];
        action.undo();
        this.index--;
    }

    redo() {
        if (this.index >= this.history.length - 1) return;

        this.index++;
        const action = this.history[this.index];
        action.redo();
    }
}

const undoManager = new UndoManager();

// Create input with history tracking
const input = new NumericInput({
    binding: new BindingTwoWay({
        history: true,
        historyName: 'Position X',
        historyPrefix: 'entity.transform'
    })
});

const observer = new Observer({ x: 0 });

// Hook into observer changes for undo/redo
let previousValue = observer.get('x');

observer.on('x:set', (newValue) => {
    const oldValue = previousValue;

    undoManager.record({
        undo: () => observer.set('x', oldValue),
        redo: () => observer.set('x', newValue)
    });

    previousValue = newValue;
});

input.link(observer, 'x');
```

### Hierarchical Scene Tree with Observer Sync

```javascript
import { Observer } from '@playcanvas/observer';
import { TreeView, TreeViewItem } from '@playcanvas/pcui';

class SceneHierarchy {
    constructor(sceneData) {
        this.sceneObserver = new Observer(sceneData);
        this.treeView = new TreeView({
            allowDrag: true,
            allowReordering: true,
            allowRenaming: true
        });

        this.itemToEntityMap = new Map();
        this.entityToItemMap = new Map();

        this._buildTree();
        this._setupSync();
    }

    _buildTree() {
        const rootEntity = this.sceneObserver.get('root');
        const rootItem = this._createTreeItem(rootEntity);
        this.treeView.append(rootItem);

        this._buildChildren(rootEntity, rootItem);
    }

    _buildChildren(entity, parentItem) {
        const children = entity.children || [];

        children.forEach(child => {
            const childItem = this._createTreeItem(child);
            parentItem.append(childItem);

            if (child.children && child.children.length > 0) {
                this._buildChildren(child, childItem);
            }
        });
    }

    _createTreeItem(entity) {
        const item = new TreeViewItem({
            text: entity.name,
            icon: this._getIconForType(entity.type),
            open: entity.expanded || false
        });

        // Create observer for this entity
        const entityObserver = new Observer(entity);

        // Sync name changes
        entityObserver.on('name:set', (newName) => {
            item.text = newName;
        });

        // Store mappings
        this.itemToEntityMap.set(item, entity);
        this.entityToItemMap.set(entity, item);

        return item;
    }

    _setupSync() {
        // Handle reparenting in tree
        this.treeView.on('reparent', (item, oldParent, newParent) => {
            const entity = this.itemToEntityMap.get(item);
            const oldParentEntity = this.itemToEntityMap.get(oldParent);
            const newParentEntity = this.itemToEntityMap.get(newParent);

            // Update data model
            const oldChildren = oldParentEntity.children;
            const index = oldChildren.indexOf(entity);
            oldChildren.splice(index, 1);

            newParentEntity.children = newParentEntity.children || [];
            newParentEntity.children.push(entity);

            // Trigger observers
            this.sceneObserver.set(`entities.${entity.id}.parent`, newParentEntity.id);
        });

        // Handle renaming
        this.treeView.on('rename', (item, newName) => {
            const entity = this.itemToEntityMap.get(item);
            const entityObserver = new Observer(entity);
            entityObserver.set('name', newName);
        });

        // Handle selection
        this.treeView.on('select', (items) => {
            const entities = items.map(item => this.itemToEntityMap.get(item));
            this._onSelectionChanged(entities);
        });
    }

    _getIconForType(type) {
        const icons = {
            'entity': 'E229',
            'camera': 'E139',
            'light': 'E208',
            'model': 'E360'
        };
        return icons[type] || 'E229';
    }

    _onSelectionChanged(entities) {
        // Notify external systems of selection change
        console.log('Selected entities:', entities);
    }
}

// Usage
const sceneData = {
    root: {
        id: 'root',
        name: 'Root',
        type: 'entity',
        children: [
            {
                id: 'camera',
                name: 'Main Camera',
                type: 'camera',
                children: []
            },
            {
                id: 'light',
                name: 'Directional Light',
                type: 'light',
                children: []
            }
        ]
    }
};

const hierarchy = new SceneHierarchy(sceneData);
document.body.appendChild(hierarchy.treeView.dom);
```

### Context Menu System

```javascript
import { Menu, MenuItem } from '@playcanvas/pcui';

class ContextMenuManager {
    constructor() {
        this.menu = null;
    }

    show(x, y, items) {
        // Close existing menu
        if (this.menu) {
            this.menu.destroy();
        }

        this.menu = new Menu();

        items.forEach(itemConfig => {
            if (itemConfig.separator) {
                // Add separator
                this.menu.append(new MenuItem({
                    text: '---',
                    enabled: false
                }));
            } else {
                const menuItem = new MenuItem({
                    text: itemConfig.text,
                    icon: itemConfig.icon,
                    enabled: itemConfig.enabled !== false,
                    onSelect: () => {
                        if (itemConfig.onSelect) {
                            itemConfig.onSelect();
                        }
                        this.menu.destroy();
                        this.menu = null;
                    }
                });

                this.menu.append(menuItem);
            }
        });

        this.menu.position(x, y);
        this.menu.hidden = false;

        // Close on click outside
        const closeHandler = (e) => {
            if (!this.menu.dom.contains(e.target)) {
                this.menu.destroy();
                this.menu = null;
                document.removeEventListener('mousedown', closeHandler);
            }
        };

        document.addEventListener('mousedown', closeHandler);
    }
}

// Usage with TreeView
const contextMenu = new ContextMenuManager();

treeView.on('contextmenu', (item, event) => {
    event.preventDefault();

    contextMenu.show(event.clientX, event.clientY, [
        {
            text: 'Duplicate',
            icon: 'E134',
            onSelect: () => {
                console.log('Duplicate', item.text);
            }
        },
        {
            text: 'Delete',
            icon: 'E289',
            onSelect: () => {
                console.log('Delete', item.text);
            }
        },
        { separator: true },
        {
            text: 'Copy',
            onSelect: () => {
                console.log('Copy', item.text);
            }
        },
        {
            text: 'Paste',
            enabled: false,
            onSelect: () => {
                console.log('Paste');
            }
        }
    ]);
});
```

### Asset Browser Pattern

```javascript
import { Container, GridView, GridViewItem, TextInput } from '@playcanvas/pcui';

class AssetBrowser {
    constructor(assets) {
        this.assets = assets;
        this.container = new Container({ flex: true });

        this._buildUI();
    }

    _buildUI() {
        // Search bar
        this.searchInput = new TextInput({
            placeholder: 'Search assets...'
        });

        this.searchInput.on('change', (value) => {
            this._filterAssets(value);
        });

        this.container.append(this.searchInput);

        // Grid view
        this.gridView = new GridView({
            multiSelect: true
        });

        this._populateGrid(this.assets);

        this.container.append(this.gridView);

        // Selection handling
        this.gridView.on('select', (items) => {
            const selectedAssets = items.map(item => item.asset);
            this._onSelectionChanged(selectedAssets);
        });

        // Double-click to open
        this.gridView.on('dblclick', (item) => {
            this._openAsset(item.asset);
        });
    }

    _populateGrid(assets) {
        this.gridView.clear();

        assets.forEach(asset => {
            const item = new GridViewItem({
                text: asset.name,
                icon: this._getIconForAssetType(asset.type)
            });

            // Store asset reference
            item.asset = asset;

            this.gridView.append(item);
        });
    }

    _filterAssets(searchTerm) {
        const term = searchTerm.toLowerCase();

        this.gridView.filter = (item) => {
            return item.text.toLowerCase().includes(term);
        };
    }

    _getIconForAssetType(type) {
        const icons = {
            'texture': 'E401',
            'model': 'E360',
            'material': 'E261',
            'script': 'E218'
        };
        return icons[type] || 'E220';
    }

    _onSelectionChanged(assets) {
        console.log('Selected assets:', assets);
    }

    _openAsset(asset) {
        console.log('Open asset:', asset);
    }
}

// Usage
const assets = [
    { name: 'Player.fbx', type: 'model' },
    { name: 'Ground.png', type: 'texture' },
    { name: 'Metal.mat', type: 'material' },
    { name: 'Controller.js', type: 'script' }
];

const browser = new AssetBrowser(assets);
document.body.appendChild(browser.container.dom);
```

---

## 9. Complete Scene Editor Example

Putting it all together:

```javascript
import { Observer } from '@playcanvas/observer';
import {
    Container, Panel, TreeView, TreeViewItem,
    LabelGroup, TextInput, NumericInput, VectorInput,
    BooleanInput, SelectInput, BindingTwoWay
} from '@playcanvas/pcui';
import '@playcanvas/pcui/styles';

class SceneEditor {
    constructor() {
        // Main container with flex layout
        this.container = new Container({
            flex: true,
            dom: 'div',
            class: 'scene-editor'
        });

        // Scene data
        this.sceneObserver = new Observer({
            entities: {
                root: {
                    id: 'root',
                    name: 'Root',
                    position: [0, 0, 0],
                    rotation: [0, 0, 0],
                    scale: [1, 1, 1],
                    children: ['camera', 'light', 'cube']
                },
                camera: {
                    id: 'camera',
                    name: 'Main Camera',
                    type: 'camera',
                    position: [0, 5, 10],
                    rotation: [-15, 0, 0],
                    scale: [1, 1, 1],
                    children: []
                },
                light: {
                    id: 'light',
                    name: 'Directional Light',
                    type: 'light',
                    position: [0, 10, 0],
                    rotation: [45, 45, 0],
                    scale: [1, 1, 1],
                    components: {
                        light: {
                            type: 'directional',
                            intensity: 1.0,
                            color: [255, 255, 255]
                        }
                    },
                    children: []
                },
                cube: {
                    id: 'cube',
                    name: 'Cube',
                    type: 'model',
                    position: [0, 0, 0],
                    rotation: [0, 0, 0],
                    scale: [1, 1, 1],
                    children: []
                }
            }
        });

        this.selectedEntities = [];

        this._buildUI();
    }

    _buildUI() {
        // Left panel - Hierarchy
        const leftPanel = new Container({
            flex: true,
            flexGrow: 1,
            flexBasis: '300px',
            resizable: 'right',
            class: 'hierarchy-panel'
        });

        this.hierarchy = this._createHierarchy();
        leftPanel.append(this.hierarchy);

        this.container.append(leftPanel);

        // Right panel - Inspector
        const rightPanel = new Container({
            flex: true,
            flexGrow: 1,
            flexBasis: '300px',
            class: 'inspector-panel'
        });

        this.inspector = new Container({ flex: true });
        rightPanel.append(this.inspector);

        this.container.append(rightPanel);
    }

    _createHierarchy() {
        const treeView = new TreeView({
            allowDrag: true,
            allowReordering: true,
            allowRenaming: true
        });

        // Build tree from scene data
        const entities = this.sceneObserver.get('entities');
        const rootData = entities.root;

        const rootItem = new TreeViewItem({
            text: rootData.name,
            icon: 'E229',
            open: true
        });

        rootItem.entityId = 'root';
        treeView.append(rootItem);

        this._buildTreeRecursive(rootData.children, rootItem, entities);

        // Handle selection
        treeView.on('select', (items) => {
            const entityIds = items.map(item => item.entityId);
            this._selectEntities(entityIds);
        });

        // Handle reparenting
        treeView.on('reparent', (item, oldParent, newParent) => {
            console.log(`Reparent ${item.text} from ${oldParent.text} to ${newParent.text}`);
            // Update scene data here
        });

        return treeView;
    }

    _buildTreeRecursive(childIds, parentItem, entities) {
        if (!childIds || childIds.length === 0) return;

        childIds.forEach(childId => {
            const childData = entities[childId];

            const item = new TreeViewItem({
                text: childData.name,
                icon: this._getIconForType(childData.type),
                open: false
            });

            item.entityId = childId;
            parentItem.append(item);

            if (childData.children && childData.children.length > 0) {
                this._buildTreeRecursive(childData.children, item, entities);
            }
        });
    }

    _selectEntities(entityIds) {
        this.selectedEntities = entityIds;
        this._updateInspector();
    }

    _updateInspector() {
        this.inspector.clear();

        if (this.selectedEntities.length === 0) {
            return;
        }

        if (this.selectedEntities.length === 1) {
            this._buildSingleEntityInspector(this.selectedEntities[0]);
        } else {
            this._buildMultiEntityInspector();
        }
    }

    _buildSingleEntityInspector(entityId) {
        const entityPath = `entities.${entityId}`;

        // Entity name panel
        const entityPanel = new Panel({
            headerText: 'Entity',
            collapsible: true
        });

        const nameInput = new TextInput({
            binding: new BindingTwoWay()
        });
        nameInput.link(this.sceneObserver, `${entityPath}.name`);

        entityPanel.append(new LabelGroup({
            text: 'Name',
            field: nameInput
        }));

        this.inspector.append(entityPanel);

        // Transform panel
        const transformPanel = new Panel({
            headerText: 'Transform',
            collapsible: true
        });

        // Position
        const posInput = new VectorInput({
            dimensions: 3,
            precision: 2,
            step: 0.1,
            binding: new BindingTwoWay()
        });
        posInput.link(this.sceneObserver, `${entityPath}.position`);

        transformPanel.append(new LabelGroup({
            text: 'Position',
            field: posInput
        }));

        // Rotation
        const rotInput = new VectorInput({
            dimensions: 3,
            precision: 1,
            step: 1,
            binding: new BindingTwoWay()
        });
        rotInput.link(this.sceneObserver, `${entityPath}.rotation`);

        transformPanel.append(new LabelGroup({
            text: 'Rotation',
            field: rotInput
        }));

        // Scale
        const scaleInput = new VectorInput({
            dimensions: 3,
            precision: 2,
            step: 0.1,
            binding: new BindingTwoWay()
        });
        scaleInput.link(this.sceneObserver, `${entityPath}.scale`);

        transformPanel.append(new LabelGroup({
            text: 'Scale',
            field: scaleInput
        }));

        this.inspector.append(transformPanel);

        // Component panels
        const entity = this.sceneObserver.get(entityPath);

        if (entity.components && entity.components.light) {
            this._buildLightComponent(entityPath);
        }
    }

    _buildLightComponent(entityPath) {
        const lightPanel = new Panel({
            headerText: 'Light Component',
            collapsible: true,
            removable: true
        });

        const lightPath = `${entityPath}.components.light`;

        // Type
        const typeInput = new SelectInput({
            options: [
                { t: 'Directional', v: 'directional' },
                { t: 'Point', v: 'point' },
                { t: 'Spot', v: 'spot' }
            ],
            binding: new BindingTwoWay()
        });
        typeInput.link(this.sceneObserver, `${lightPath}.type`);

        lightPanel.append(new LabelGroup({
            text: 'Type',
            field: typeInput
        }));

        // Intensity
        const intensityInput = new NumericInput({
            min: 0,
            max: 10,
            precision: 2,
            step: 0.1,
            binding: new BindingTwoWay()
        });
        intensityInput.link(this.sceneObserver, `${lightPath}.intensity`);

        lightPanel.append(new LabelGroup({
            text: 'Intensity',
            field: intensityInput
        }));

        this.inspector.append(lightPanel);
    }

    _buildMultiEntityInspector() {
        const panel = new Panel({
            headerText: `Multiple Entities (${this.selectedEntities.length})`
        });

        // Show common properties only
        // For now, just show a message
        const label = new Label({
            text: 'Select a single entity to edit properties'
        });

        panel.append(label);
        this.inspector.append(panel);
    }

    _getIconForType(type) {
        const icons = {
            'camera': 'E139',
            'light': 'E208',
            'model': 'E360'
        };
        return icons[type] || 'E229';
    }

    get dom() {
        return this.container.dom;
    }
}

// Initialize and mount
const editor = new SceneEditor();
document.body.appendChild(editor.dom);

// Add custom styling
const style = document.createElement('style');
style.textContent = `
    body {
        margin: 0;
        padding: 0;
        background-color: #364346;
        font-family: 'Helvetica Neue', sans-serif;
    }

    .scene-editor {
        width: 100vw;
        height: 100vh;
        display: flex;
        flex-direction: row;
    }

    .hierarchy-panel,
    .inspector-panel {
        overflow-y: auto;
        padding: 8px;
    }
`;
document.head.appendChild(style);
```

---

## 10. Key Takeaways

### Architecture Strengths

1. **Clean Hierarchy**: Element → Container/InputElement → Specialized components
2. **Observer Pattern**: Decoupled data binding with `@playcanvas/observer`
3. **Flexible Binding**: One-way and two-way options for different use cases
4. **Component Registration**: Static registry for creating components by name
5. **Event-Driven**: Rich event system for all user interactions

### Best Practices for Scene Editors

1. **Use Observers for all data**: Keep UI and data models synchronized
2. **LabelGroup for property rows**: Consistent label-field pairing
3. **Panels for sections**: Collapsible, removable, sortable panels
4. **TreeView for hierarchies**: Built-in drag-drop, selection, filtering
5. **VectorInput for transforms**: Specialized input for position/rotation/scale
6. **Binding history**: Enable undo/redo support in critical inputs
7. **Multi-selection support**: Handle both single and multiple selection states

### Integration Points

1. **Data Layer**: Observer pattern integrates with any data model
2. **Rendering**: PCUI is UI-only, pairs with any 3D engine
3. **Undo/Redo**: Hook into Observer events for history tracking
4. **Themes**: SCSS variables for custom styling
5. **React Support**: Full React wrapper available

---

## Resources

- **Documentation**: https://developer.playcanvas.com/user-manual/pcui/
- **API Reference**: https://api.playcanvas.com/pcui
- **Storybook Examples**: https://playcanvas.github.io/pcui/storybook/
- **Source Code**: https://github.com/playcanvas/pcui
- **Observer Library**: https://github.com/playcanvas/observer
- **npm Package**: `@playcanvas/pcui`

---

This analysis covers the complete PCUI architecture with practical examples for building production-ready scene editors. The library provides all necessary components for hierarchies, property inspectors, data binding, and theming, making it an excellent foundation for editor interfaces.
