# PlayCanvas Expert Skill

## Overview
Comprehensive knowledge base for PlayCanvas engine development, including the core engine, React bindings, SuperSplat (Gaussian splats), PCUI components, and Observer pattern for state management.

---

## PlayCanvas Engine Core

### Application Setup
```javascript
import * as pc from 'playcanvas';

// Create graphics device
const device = await pc.createGraphicsDevice(canvas, {
    deviceTypes: [pc.DEVICETYPE_WEBGPU, pc.DEVICETYPE_WEBGL2]
});

// Create application
const app = new pc.Application(canvas, {
    graphicsDevice: device,
    mouse: new pc.Mouse(canvas),
    keyboard: new pc.Keyboard(window),
    touch: pc.platform.touch ? new pc.TouchDevice(canvas) : undefined
});

// Configure canvas
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.setCanvasResolution(pc.RESOLUTION_AUTO);

// Start render loop
app.start();
```

### Entity-Component System

**Entity Creation:**
```javascript
const entity = new pc.Entity('name');
entity.setPosition(x, y, z);
entity.setEulerAngles(rx, ry, rz);  // Degrees
entity.setLocalScale(sx, sy, sz);
entity.tags.add('player', 'collidable');
app.root.addChild(entity);
```

**Finding Entities:**
```javascript
app.root.findByName('EntityName');
app.root.findByTag('player');
app.root.findByPath('Parent/Child/Entity');
app.root.findComponents('camera');  // All camera components
```

### Components Reference

**Render Component (Primitives):**
```javascript
entity.addComponent('render', {
    type: 'box',  // 'sphere', 'cylinder', 'cone', 'plane', 'capsule'
    material: material,
    castShadows: true,
    receiveShadows: true
});
```

**Model Component (GLB/GLTF):**
```javascript
entity.addComponent('model', {
    type: 'asset',
    asset: modelAsset,
    castShadows: true,
    receiveShadows: true,
    castShadowsLightmap: true
});
```

**Camera Component:**
```javascript
entity.addComponent('camera', {
    clearColor: new pc.Color(0.1, 0.1, 0.1),
    fov: 75,
    nearClip: 0.1,
    farClip: 1000,
    frustumCulling: true,
    priority: 0,  // Higher = renders later
    layers: [pc.LAYERID_WORLD, pc.LAYERID_UI]
});
```

**Light Component:**
```javascript
entity.addComponent('light', {
    type: 'directional',  // 'point', 'spot'
    color: new pc.Color(1, 0.98, 0.95),
    intensity: 1.2,
    castShadows: true,
    shadowBias: 0.2,
    shadowDistance: 100,
    shadowResolution: 2048,
    normalOffsetBias: 0.05,
    shadowType: pc.SHADOW_PCF3  // Soft shadows
});

// Spot light specific
entity.light.innerConeAngle = 30;
entity.light.outerConeAngle = 45;

// Point light specific
entity.light.range = 10;
entity.light.falloffMode = pc.LIGHTFALLOFF_LINEAR;
```

**Rigidbody Component (Physics):**
```javascript
entity.addComponent('rigidbody', {
    type: 'dynamic',  // 'static', 'kinematic'
    mass: 1,
    friction: 0.5,
    restitution: 0.3,
    linearDamping: 0.1,
    angularDamping: 0.1,
    linearFactor: new pc.Vec3(1, 1, 1),
    angularFactor: new pc.Vec3(1, 1, 1)
});

// Apply forces
entity.rigidbody.applyForce(force);
entity.rigidbody.applyImpulse(impulse);
entity.rigidbody.applyTorque(torque);

// Teleport
entity.rigidbody.teleport(position, rotation);
```

**Collision Component:**
```javascript
entity.addComponent('collision', {
    type: 'box',  // 'sphere', 'capsule', 'cylinder', 'mesh'
    halfExtents: new pc.Vec3(0.5, 0.5, 0.5)  // for box
});

// Sphere
entity.collision.radius = 0.5;

// Capsule
entity.collision.radius = 0.5;
entity.collision.height = 2;

// Trigger (no physics response)
entity.collision.on('triggerenter', (other) => { });
entity.collision.on('triggerleave', (other) => { });

// Contact
entity.collision.on('collisionstart', (result) => { });
entity.collision.on('collisionend', (other) => { });
```

**Animation Component (Modern - Anim):**
```javascript
entity.addComponent('anim', {
    activate: true,
    speed: 1
});

// Assign animation clips
entity.anim.assignAnimation('idle', idleClip);
entity.anim.assignAnimation('walk', walkClip);

// Play animation
entity.anim.baseLayer.play('idle');
entity.anim.baseLayer.transition('walk', 0.2);  // Blend time
```

**Animation State Graph:**
```javascript
const stateGraph = {
    layers: [{
        name: 'Base',
        states: [
            { name: 'idle', speed: 1, loop: true },
            { name: 'walk', speed: 1, loop: true },
            { name: 'run', speed: 1.5, loop: true }
        ],
        transitions: [
            {
                from: 'idle',
                to: 'walk',
                time: 0.2,
                conditions: [{
                    parameter: 'speed',
                    predicate: pc.ANIM_GREATER_THAN,
                    value: 0.1
                }]
            },
            {
                from: 'walk',
                to: 'run',
                time: 0.2,
                conditions: [{
                    parameter: 'speed',
                    predicate: pc.ANIM_GREATER_THAN,
                    value: 3
                }]
            }
        ]
    }],
    parameters: {
        speed: { type: pc.ANIM_PARAMETER_FLOAT, value: 0 }
    }
};

entity.anim.stateGraph = stateGraph;
entity.anim.setFloat('speed', currentSpeed);
```

**Legacy Animation Component:**
```javascript
entity.addComponent('animation', {
    activate: true,
    speed: 1,
    loop: true
});

entity.animation.play('idle', 0.3);  // Blend time
entity.animation.animations = { idle: clip1, walk: clip2 };
```

**Audio Components:**
```javascript
// Audio listener (attach to camera)
camera.addComponent('audiolistener');

// Sound source
entity.addComponent('sound', {
    positional: true,
    distanceModel: 'linear',  // 'inverse', 'exponential'
    refDistance: 1,
    maxDistance: 100,
    rollOffFactor: 1
});

entity.sound.addSlot('ambient', {
    asset: audioAsset,
    loop: true,
    autoPlay: true,
    volume: 0.5,
    pitch: 1
});

entity.sound.play('ambient');
entity.sound.stop('ambient');
```

**Particle System:**
```javascript
entity.addComponent('particleemitter', {
    numParticles: 100,
    lifetime: 2,
    rate: 10,
    rate2: 15,
    startAngle: 0,
    startAngle2: 360,
    emitterShape: pc.EMITTERSHAPE_SPHERE,
    emitterRadius: 1,

    // Color over lifetime
    colorGraph: new pc.CurveSet([
        new pc.Curve([0, 1, 1, 1]),      // R
        new pc.Curve([0, 0.5, 1, 0]),    // G
        new pc.Curve([0, 0, 1, 0])       // B
    ]),

    // Velocity
    velocityGraph: new pc.CurveSet([
        new pc.Curve([0, 0]),            // X
        new pc.Curve([0, 5, 1, 2]),      // Y
        new pc.Curve([0, 0])             // Z
    ]),

    // Scale over lifetime
    scaleGraph: new pc.Curve([0, 0.1, 0.5, 0.3, 1, 0])
});
```

### Materials

**Standard Material:**
```javascript
const material = new pc.StandardMaterial();
material.diffuse = new pc.Color(r, g, b);
material.specular = new pc.Color(1, 1, 1);
material.metalness = 0.5;
material.gloss = 0.7;  // Shininess

// Emissive (glow)
material.emissive = new pc.Color(r, g, b);
material.emissiveIntensity = 2;

// Transparency
material.opacity = 0.5;
material.blendType = pc.BLEND_NORMAL;
material.depthWrite = false;  // For proper transparency sorting

// Textures
material.diffuseMap = diffuseTexture;
material.normalMap = normalTexture;
material.heightMap = heightTexture;
material.glossMap = glossTexture;
material.metalnessMap = metalnessTexture;
material.emissiveMap = emissiveTexture;

material.update();
meshInstance.material = material;
```

**Blend Types:**
```javascript
pc.BLEND_NONE           // Opaque
pc.BLEND_NORMAL         // Alpha blending
pc.BLEND_ADDITIVE       // Additive
pc.BLEND_MULTIPLICATIVE // Multiply
pc.BLEND_PREMULTIPLIED  // Premultiplied alpha
```

### Asset Loading

**Container Assets (GLB/GLTF):**
```javascript
const asset = new pc.Asset('model', 'container', {
    url: 'path/to/model.glb'
});

asset.on('load', () => {
    const container = asset.resource;

    // Instantiate model
    const entity = container.instantiateRenderEntity();
    app.root.addChild(entity);

    // Access animations
    if (container.animations) {
        container.animations.forEach(clip => {
            entity.anim.assignAnimation(clip.name, clip);
        });
    }
});

asset.on('error', (err) => {
    console.error('Load failed:', err);
});

app.assets.add(asset);
app.assets.load(asset);
```

**Texture Assets:**
```javascript
const texture = new pc.Asset('texture', 'texture', {
    url: 'path/to/texture.png'
});

texture.on('load', () => {
    material.diffuseMap = texture.resource;
    material.update();
});

app.assets.add(texture);
app.assets.load(texture);
```

### Scene Settings

**Rendering:**
```javascript
// Tone mapping
app.scene.toneMapping = pc.TONEMAP_ACES;  // FILMIC, LINEAR, HEJL
app.scene.exposure = 1.1;
app.scene.gammaCorrection = pc.GAMMA_SRGB;

// Ambient light
app.scene.ambientLight = new pc.Color(0.2, 0.2, 0.3);

// Clustered lighting
app.scene.clusteredLightingEnabled = true;
```

**Fog:**
```javascript
app.scene.fog = pc.FOG_LINEAR;  // FOG_EXP, FOG_EXP2, FOG_NONE
app.scene.fogColor = new pc.Color(0.5, 0.5, 0.6);
app.scene.fogStart = 10;    // Linear only
app.scene.fogEnd = 100;     // Linear only
app.scene.fogDensity = 0.02; // Exponential only
```

**Skybox:**
```javascript
// Solid color
app.scene.skyboxMip = 0;

// Cubemap
const cubemap = new pc.Texture(device, {
    cubemap: true,
    width: 512,
    height: 512
});
app.scene.setSkybox(cubemap);
app.scene.skyboxIntensity = 1;
app.scene.skyboxRotation = new pc.Quat();
```

### Input Handling

**Keyboard:**
```javascript
app.keyboard.on(pc.EVENT_KEYDOWN, (e) => {
    if (e.key === pc.KEY_SPACE) {
        // Jump
    }
});

// Polling
if (app.keyboard.isPressed(pc.KEY_W)) {
    // Move forward
}
if (app.keyboard.wasPressed(pc.KEY_E)) {
    // Just pressed this frame
}
```

**Mouse:**
```javascript
app.mouse.on(pc.EVENT_MOUSEDOWN, (e) => {
    if (e.button === pc.MOUSEBUTTON_LEFT) {
        // Click
    }
});

app.mouse.on(pc.EVENT_MOUSEMOVE, (e) => {
    const dx = e.dx;
    const dy = e.dy;
});

// Pointer lock
canvas.requestPointerLock();
document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
});
```

**Raycasting:**
```javascript
// Screen to world ray
const from = camera.camera.screenToWorld(e.x, e.y, camera.camera.nearClip);
const to = camera.camera.screenToWorld(e.x, e.y, camera.camera.farClip);

// Physics raycast
const result = app.systems.rigidbody.raycastFirst(from, to);
if (result) {
    const hitEntity = result.entity;
    const hitPoint = result.point;
    const hitNormal = result.normal;
}

// All hits
const results = app.systems.rigidbody.raycastAll(from, to);
```

### Event System

**Application Events:**
```javascript
// Subscribe
app.on('update', (dt) => { });
app.on('prerender', () => { });
app.on('postrender', () => { });

// Custom events
app.fire('custom:event', { data });
app.on('custom:event', (data) => { });

// Unsubscribe
app.off('update', handler);
```

**Entity Events:**
```javascript
entity.on('destroy', () => { });
entity.on('enable', () => { });
entity.on('disable', () => { });
```

---

## Gaussian Splat Rendering (SuperSplat)

### Loading Splats
```javascript
// Supported formats: .ply, .splat, .ksplat
const splatAsset = new pc.Asset('splat', 'gsplat', {
    url: 'path/to/scene.ply'
});

splatAsset.on('load', () => {
    const splatEntity = new pc.Entity('Splat');
    splatEntity.addComponent('gsplat', {
        asset: splatAsset
    });
    app.root.addChild(splatEntity);
});
```

### Splat Component Properties
```javascript
entity.gsplat.asset = splatAsset;
entity.gsplat.castShadows = false;
entity.gsplat.receiveShadows = true;
entity.gsplat.opacity = 1;
```

### Camera for Splats
```javascript
// Splats require specific camera setup
camera.camera.clearColor = new pc.Color(0, 0, 0);
camera.camera.fov = 60;
camera.camera.nearClip = 0.1;
camera.camera.farClip = 1000;
```

---

## PlayCanvas React (React Bindings)

### Application Component
```jsx
import { Application, Entity, Camera, Light, Render } from '@playcanvas/react';

function Scene() {
    return (
        <Application>
            <Entity name="camera" position={[0, 2, 5]}>
                <Camera clearColor="#1a1a2e" fov={75} />
            </Entity>

            <Entity name="light" rotation={[45, 30, 0]}>
                <Light type="directional" intensity={1.2} castShadows />
            </Entity>

            <Entity name="cube" position={[0, 0.5, 0]}>
                <Render type="box" />
            </Entity>
        </Application>
    );
}
```

### Component Props

**Camera:**
```jsx
<Camera
    clearColor="#000000"
    fov={75}
    nearClip={0.1}
    farClip={1000}
    priority={0}
/>
```

**Light:**
```jsx
<Light
    type="directional"  // "point", "spot"
    color="#ffffff"
    intensity={1}
    castShadows
    shadowResolution={2048}
/>
```

**Render:**
```jsx
<Render
    type="box"  // "sphere", "cylinder", "plane", "cone"
    material={material}
    castShadows
    receiveShadows
/>
```

**Model:**
```jsx
<Model
    asset={modelAsset}
    castShadows
    receiveShadows
/>
```

**Animation:**
```jsx
<Anim
    stateGraph={stateGraph}
    activate
    speed={1}
/>
```

### Hooks
```jsx
import { useApp, useEntity, useAsset } from '@playcanvas/react';

function MyComponent() {
    const app = useApp();           // Get pc.Application
    const entity = useEntity();     // Get parent pc.Entity
    const asset = useAsset('model.glb');  // Load asset

    useEffect(() => {
        // Access PlayCanvas directly
        app.fire('event', data);
    }, [app]);

    return null;
}
```

---

## PCUI Components

### Installation
```bash
npm install @playcanvas/pcui
npm install @playcanvas/pcui/react  # React bindings
```

### Core Components

**Container:**
```jsx
import { Container, Panel, Button, Label } from '@playcanvas/pcui/react';

<Container flex>
    <Panel headerText="Transform">
        <VectorInput label="Position" value={[0, 0, 0]} />
        <VectorInput label="Rotation" value={[0, 0, 0]} />
        <VectorInput label="Scale" value={[1, 1, 1]} />
    </Panel>
</Container>
```

**Input Components:**
```jsx
<NumericInput value={0} min={-10} max={10} step={0.1} precision={2} />
<SliderInput value={50} min={0} max={100} />
<BooleanInput value={true} />
<TextInput value="text" placeholder="Enter text" />
<TextAreaInput value="" rows={4} />
<SelectInput options={[{ v: 1, t: 'One' }, { v: 2, t: 'Two' }]} />
<ColorPicker value="#ff0000" />
<VectorInput value={[0, 0, 0]} dimensions={3} />
```

**Layout:**
```jsx
<Panel collapsible headerText="Settings">
    <LabelGroup text="Name">
        <TextInput />
    </LabelGroup>
</Panel>

<TreeView>
    <TreeViewItem text="Root">
        <TreeViewItem text="Child 1" />
        <TreeViewItem text="Child 2" />
    </TreeViewItem>
</TreeView>
```

**Buttons & Actions:**
```jsx
<Button text="Click Me" onClick={() => {}} />
<Button icon="&#xe800;" />  // Icon button
```

### Data Binding (Observer Pattern)
```javascript
import { Observer } from '@playcanvas/observer';

const data = new Observer({
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 }
});

// Listen for changes
data.on('position:set', (value, oldValue) => {
    entity.setPosition(value.x, value.y, value.z);
});

// Two-way binding
<VectorInput
    binding={new BindingTwoWay()}
    link={{ observer: data, path: 'position' }}
/>
```

### Theming
```scss
// PCUI uses SCSS variables
$font-size: 14px;
$color-bg: #1a1a2e;
$color-text: #ffffff;
$color-primary: #a855f7;
```

---

## Observer Pattern (State Management)

### Basic Usage
```javascript
import { Observer } from '@playcanvas/observer';

const state = new Observer({
    scene: {
        objects: [],
        selectedId: null
    },
    environment: {
        skyColor: '#000000',
        fogEnabled: false
    }
});

// Deep path access
state.set('scene.selectedId', 'entity-123');
const selected = state.get('scene.selectedId');

// Listen to changes
state.on('scene.selectedId:set', (value, oldValue) => {
    updateSelection(value);
});

state.on('*:set', (path, value, oldValue) => {
    console.log(`${path} changed from ${oldValue} to ${value}`);
});
```

### History (Undo/Redo)
```javascript
class History {
    constructor(observer) {
        this.observer = observer;
        this.stack = [];
        this.index = -1;
        this.enabled = true;

        observer.on('*:set', (path, value, oldValue) => {
            if (this.enabled) {
                this.push({ path, oldValue, newValue: value });
            }
        });
    }

    push(action) {
        this.stack = this.stack.slice(0, this.index + 1);
        this.stack.push(action);
        this.index++;
    }

    undo() {
        if (this.index >= 0) {
            const action = this.stack[this.index];
            this.enabled = false;
            this.observer.set(action.path, action.oldValue);
            this.enabled = true;
            this.index--;
        }
    }

    redo() {
        if (this.index < this.stack.length - 1) {
            this.index++;
            const action = this.stack[this.index];
            this.enabled = false;
            this.observer.set(action.path, action.newValue);
            this.enabled = true;
        }
    }
}
```

---

## Performance Optimization

### Culling
```javascript
// Frustum culling (enabled by default)
entity.render.meshInstances[0].visibleThisFrame; // Check if rendered

// Manual visibility
entity.enabled = false;  // Disable entity and children
entity.render.enabled = false;  // Disable just render
```

### Batching
```javascript
// Use same material for multiple objects
const sharedMaterial = new pc.StandardMaterial();
objects.forEach(obj => {
    obj.render.meshInstances[0].material = sharedMaterial;
});

// Static batching (for non-moving objects)
entity.render.batchGroupId = batchGroup.id;
```

### LOD (Level of Detail)
```javascript
// Set LOD distances
meshInstance.lodDistances = [10, 30, 100, 500];

// Screen space LOD
meshInstance.screenSpaceSize = true;
```

### Animation Performance
```javascript
// Pause off-screen animations
if (!entity.render.meshInstances[0].visibleThisFrame) {
    entity.anim.speed = 0;
} else {
    entity.anim.speed = 1;
}
```

### Memory Management
```javascript
// Destroy entities properly
entity.destroy();

// Unload assets
app.assets.unload(asset);

// Clear event listeners
app.off('update', handler);
entity.off('destroy', handler);
```

---

## Common Patterns

### First-Person Controller
```javascript
const speed = 5;
const lookSensitivity = 0.1;
let pitch = 0, yaw = 0;

app.on('update', (dt) => {
    // Mouse look
    if (isPointerLocked) {
        yaw -= mouseMovementX * lookSensitivity;
        pitch -= mouseMovementY * lookSensitivity;
        pitch = pc.math.clamp(pitch, -89, 89);
        camera.setEulerAngles(pitch, yaw, 0);
    }

    // WASD movement
    const forward = new pc.Vec3();
    const right = new pc.Vec3();
    camera.getWorldTransform().getZ(forward);
    camera.getWorldTransform().getX(right);
    forward.y = 0;
    forward.normalize();

    const move = new pc.Vec3();
    if (keyboard.isPressed(pc.KEY_W)) move.sub(forward);
    if (keyboard.isPressed(pc.KEY_S)) move.add(forward);
    if (keyboard.isPressed(pc.KEY_A)) move.sub(right);
    if (keyboard.isPressed(pc.KEY_D)) move.add(right);

    move.normalize().mulScalar(speed * dt);
    player.translate(move);
});
```

### Third-Person Camera
```javascript
const cameraOffset = new pc.Vec3(0, 4, 8);
const lookOffset = new pc.Vec3(0, 1.5, 0);
const smoothSpeed = 5;

app.on('update', (dt) => {
    const targetPos = target.getPosition().clone();
    targetPos.add(lookOffset);

    // Orbit position
    const yawRad = yaw * Math.PI / 180;
    const pitchRad = pitch * Math.PI / 180;

    const offset = new pc.Vec3(
        Math.sin(yawRad) * Math.cos(pitchRad) * cameraOffset.z,
        Math.sin(pitchRad) * cameraOffset.z + cameraOffset.y,
        Math.cos(yawRad) * Math.cos(pitchRad) * cameraOffset.z
    );

    const desiredPos = targetPos.clone().add(offset);
    camera.getPosition().lerp(camera.getPosition(), desiredPos, smoothSpeed * dt);
    camera.lookAt(targetPos);
});
```

### Object Pooling
```javascript
class ObjectPool {
    constructor(createFn, initialSize = 10) {
        this.pool = [];
        this.createFn = createFn;

        for (let i = 0; i < initialSize; i++) {
            this.pool.push(this.createFn());
        }
    }

    get() {
        return this.pool.length > 0
            ? this.pool.pop()
            : this.createFn();
    }

    release(obj) {
        obj.enabled = false;
        this.pool.push(obj);
    }
}
```

---

## Debugging

### Console Helpers
```javascript
// Entity info
console.log(entity.name, entity.getPosition(), entity.getEulerAngles());

// Component check
console.log('Has render:', !!entity.render);
console.log('Has rigidbody:', !!entity.rigidbody);

// Asset status
console.log('Asset loaded:', asset.loaded);
console.log('Asset loading:', asset.loading);
```

### Performance Profiling
```javascript
app.on('frameend', () => {
    console.log('Draw calls:', app.graphicsDevice.drawCalls);
    console.log('Triangles:', app.graphicsDevice.triangles);
});
```

### Visual Debugging
```javascript
// Draw debug line
app.drawLine(start, end, color, false, layer);

// Draw debug sphere
app.drawSphere(position, radius, color, 16, false, layer);
```
