import React, { useRef, useEffect, useMemo, useState } from 'react';

type OphanimState = 'idle' | 'generating' | 'looking' | 'speaking' | 'editing' | 'listening' | 'dreaming' | 'inspiring' | 'reasoning' | 'processing' | 'building';

interface StateConfig {
  color: string;
  glow: string;
  label: string | null;
  ringSpeed: number;
  pulsate: boolean;
}

interface BuildProgress {
  phase: 'initializing' | 'decomposing' | 'distributing' | 'generating' | 'executing' | 'complete' | 'error';
  completedTasks: number;
  totalTasks: number;
}

interface OphanimIndicatorProps {
  state?: OphanimState;
  size?: number;
  transitionDuration?: number;
  showLabel?: boolean;
}

/**
 * OphanimIndicator - Procedural animated state indicator
 */
const OphanimIndicator: React.FC<OphanimIndicatorProps> = ({
  state = 'idle',
  size = 100,
  transitionDuration = 0.6,
  showLabel: showLabelProp = true,
}) => {
  const orbRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const ringsRef = useRef<(HTMLDivElement | null)[]>([]);
  const frameRef = useRef<number | null>(null);
  const timeRef = useRef(0);
  const currentSpeedRef = useRef(0.3);
  const targetSpeedRef = useRef(0.3);
  const currentPulsateRef = useRef(0);
  const targetPulsateRef = useRef(0);

  // Parallel build progress state
  const [buildProgress, setBuildProgress] = useState<BuildProgress | null>(null);

  // Listen for parallel build progress events
  useEffect(() => {
    const handleBuildProgress = (event: CustomEvent<BuildProgress>) => {
      const progress = event.detail;
      if (progress.phase === 'complete' || progress.phase === 'error') {
        // Clear build progress after a short delay
        setTimeout(() => setBuildProgress(null), 1500);
      }
      setBuildProgress(progress);
    };

    window.addEventListener('hon-build-progress', handleBuildProgress as EventListener);
    return () => {
      window.removeEventListener('hon-build-progress', handleBuildProgress as EventListener);
    };
  }, []);

  const stateConfig = useMemo<Record<OphanimState, StateConfig>>(() => ({
    generating: { 
      color: '#a855f7', // Purple (default for image/3D)
      glow: 'rgba(168, 85, 247, 0.5)', 
      label: 'Generating',
      ringSpeed: 1.8,
      pulsate: false,
    },
    looking: { 
      color: '#a855f7', // Purple
      glow: 'rgba(168, 85, 247, 0.5)', 
      label: null, // No label for looking
      ringSpeed: 0.6,
      pulsate: true,
    },
    listening: { 
      color: '#a855f7', // Purple
      glow: 'rgba(168, 85, 247, 0.5)', 
      label: null, // No label for listening (like idle)
      ringSpeed: 0.5,
      pulsate: true,
    },
    speaking: { 
      color: '#4facfe', // Blue
      glow: 'rgba(79, 172, 254, 0.5)', 
      label: 'Speaking',
      ringSpeed: 1.2,
      pulsate: true,
    },
    editing: { 
      color: '#4ade80', // Green
      glow: 'rgba(74, 222, 128, 0.5)', 
      label: 'Editing',
      ringSpeed: 1.0,
      pulsate: false,
    },
    dreaming: { 
      color: '#ec4899', // Pink (for video generating)
      glow: 'rgba(236, 72, 153, 0.5)', 
      label: 'Generating', // Show as "Generating" for video
      ringSpeed: 0.8,
      pulsate: true,
    },
    inspiring: { 
      color: '#a855f7', // Purple
      glow: 'rgba(168, 85, 247, 0.5)', 
      label: null, // No label
      ringSpeed: 0.7,
      pulsate: true,
    },
    reasoning: { 
      color: '#a855f7', 
      glow: 'rgba(168, 85, 247, 0.5)', 
      label: null, // No label
      ringSpeed: 1.5,
      pulsate: false,
    },
    processing: { 
      color: '#a855f7', 
      glow: 'rgba(168, 85, 247, 0.5)', 
      label: null, // No label
      ringSpeed: 1.6,
      pulsate: false,
    },
    idle: {
      color: '#a855f7',
      glow: 'rgba(168, 85, 247, 0.4)',
      label: null,
      ringSpeed: 0.3,
      pulsate: false,
    },
    building: {
      color: '#22c55e', // Green for building
      glow: 'rgba(34, 197, 94, 0.5)',
      label: 'Building',
      ringSpeed: 1.6,
      pulsate: false,
    },
  }), []);

  // Dynamic label based on build progress
  const dynamicLabel = useMemo(() => {
    if (buildProgress && (buildProgress.totalTasks > 1 || buildProgress.phase === 'initializing' || buildProgress.phase === 'decomposing')) {
      switch (buildProgress.phase) {
        case 'initializing':
          return 'Spinning Up';
        case 'decomposing':
          return 'Planning';
        case 'distributing':
          return 'Distributing Tasks';
        case 'generating':
          return `Building ${buildProgress.completedTasks}/${buildProgress.totalTasks}`;
        case 'executing':
          return 'Assembling';
        case 'complete':
          return `Built ${buildProgress.completedTasks} sections`;
        case 'error':
          return 'Build Error';
        default:
          return null;
      }
    }
    return null;
  }, [buildProgress]);

  const rings = useMemo(() => [
    { radius: 38, rotateX: 70, rotateY: 0, speed: 1, width: 2 },
    { radius: 34, rotateX: 0, rotateY: 80, speed: -0.7, width: 1.5 },
    { radius: 42, rotateX: 45, rotateY: 45, speed: 0.5, width: 1.5 },
    { radius: 30, rotateX: 85, rotateY: 30, speed: -1.2, width: 2 },
  ], []);

  const currentState = stateConfig[state] || stateConfig.idle;
  // Show label if: has dynamic build label OR (prop allows and state has label)
  const displayLabel = dynamicLabel || currentState.label;
  const showLabel = showLabelProp && (dynamicLabel || (state !== 'idle' && currentState.label));

  // Use building color when parallel building is active
  const effectiveState = buildProgress && buildProgress.totalTasks > 1 ? stateConfig.building : currentState;

  useEffect(() => {
    targetSpeedRef.current = currentState.ringSpeed;
    targetPulsateRef.current = currentState.pulsate ? 1 : 0;
  }, [currentState.ringSpeed, currentState.pulsate]);

  useEffect(() => {
    const easingFactor = 0.02 / (transitionDuration * 0.1);

    const animate = () => {
      timeRef.current += 0.02;
      const t = timeRef.current;

      currentSpeedRef.current += (targetSpeedRef.current - currentSpeedRef.current) * easingFactor;
      currentPulsateRef.current += (targetPulsateRef.current - currentPulsateRef.current) * easingFactor;
      
      const speedMultiplier = currentSpeedRef.current;
      const pulsateAmount = currentPulsateRef.current;

      ringsRef.current.forEach((ring, i) => {
        if (ring) {
          const ringConfig = rings[i];
          const rotation = t * ringConfig.speed * speedMultiplier;
          ring.style.transform = `
            rotateX(${ringConfig.rotateX + rotation * 30}deg) 
            rotateY(${ringConfig.rotateY + rotation * 50}deg)
            rotateZ(${rotation * 20}deg)
          `;
          ring.style.opacity = String(0.75 + Math.sin(t + i) * 0.15);
        }
      });

      if (orbRef.current) {
        const wave1 = Math.sin(t * 8) * 0.15;
        const wave2 = Math.sin(t * 12) * 0.1;
        const wave3 = Math.sin(t * 5) * 0.08;
        const pulsation = 1 + (wave1 + wave2 + wave3) * pulsateAmount;
        orbRef.current.style.transform = `scale(${pulsation})`;
      }

      if (glowRef.current) {
        const glowOpacity = 0.6 + Math.sin(t * 2) * 0.2;
        glowRef.current.style.opacity = String(glowOpacity);
        const wave1 = Math.sin(t * 8) * 0.15;
        const wave2 = Math.sin(t * 12) * 0.1;
        const pulsation = 1 + (wave1 + wave2) * pulsateAmount;
        glowRef.current.style.transform = `translate(-50%, -50%) scale(${pulsation * 1.1})`;
      }

      frameRef.current = requestAnimationFrame(animate);
    };

    frameRef.current = requestAnimationFrame(animate);
    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [rings, transitionDuration]);

  const scale = size / 100;
  const orbBaseSize = size * 0.4;

  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10 * scale }}>
      {/* Label - positioned on the left */}
      {showLabel && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 3 * scale,
          padding: `${4 * scale}px ${8 * scale}px`,
          borderRadius: 12 * scale,
          background: effectiveState.color,
          boxShadow: `0 2px 8px ${effectiveState.glow}`,
          transition: `background ${transitionDuration}s ease, box-shadow ${transitionDuration}s ease`,
        }}>
          <div style={{
            width: 4 * scale,
            height: 4 * scale,
            borderRadius: '50%',
            background: 'white',
            opacity: 0.9,
          }} />
          <span style={{
            fontSize: 7 * scale,
            fontWeight: 600,
            color: 'white',
            letterSpacing: 0.3 * scale,
            textTransform: 'uppercase',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}>
            {displayLabel}
          </span>
        </div>
      )}

      {/* Orb container */}
      <div style={{
        position: 'relative',
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        perspective: 200,
      }}>
        {/* Glow */}
        <div
          ref={glowRef}
          style={{
            position: 'absolute',
            width: size * 0.9,
            height: size * 0.9,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${effectiveState.color}60 0%, ${effectiveState.glow} 30%, transparent 70%)`,
            filter: 'blur(12px)',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            willChange: 'transform, opacity',
            transition: `background ${transitionDuration}s ease`,
          }}
        />

        {/* Rings */}
        <div style={{ position: 'absolute', width: size, height: size, transformStyle: 'preserve-3d' }}>
          {rings.map((ring, i) => (
            <div
              key={i}
              ref={el => { ringsRef.current[i] = el; }}
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                width: ring.radius * 2 * scale,
                height: ring.radius * 2 * scale,
                marginLeft: -ring.radius * scale,
                marginTop: -ring.radius * scale,
                borderRadius: '50%',
                border: `${ring.width * scale}px solid ${effectiveState.color}`,
                boxShadow: `0 0 ${10 * scale}px ${effectiveState.glow}, inset 0 0 ${10 * scale}px ${effectiveState.glow}`,
                transformStyle: 'preserve-3d',
                willChange: 'transform, opacity',
                transition: `border-color ${transitionDuration}s ease, box-shadow ${transitionDuration}s ease`,
              }}
            />
          ))}
        </div>

        {/* Orb */}
        <div
          ref={orbRef}
          style={{
            position: 'relative',
            width: orbBaseSize,
            height: orbBaseSize,
            borderRadius: '50%',
            background: `radial-gradient(circle at 35% 35%,
              ${effectiveState.color}90 0%,
              ${effectiveState.color}60 30%,
              #2a2a3e 70%,
              #1a1a28 100%
            )`,
            boxShadow: `
              0 0 ${25 * scale}px ${effectiveState.color}80,
              0 0 ${50 * scale}px ${effectiveState.glow},
              0 0 ${80 * scale}px ${effectiveState.glow},
              inset 0 0 ${20 * scale}px ${effectiveState.color}50
            `,
            overflow: 'hidden',
            zIndex: 10,
            willChange: 'transform',
            transition: `background ${transitionDuration}s ease, box-shadow ${transitionDuration}s ease`,
          }}
        >
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '60%',
            height: '60%',
            borderRadius: '50%',
            background: `radial-gradient(circle, ${effectiveState.color}60 0%, transparent 70%)`,
            filter: 'blur(4px)',
            transition: `background ${transitionDuration}s ease`,
          }} />
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '25%',
            height: '25%',
            borderRadius: '50%',
            background: 'white',
            opacity: 0.7,
            filter: 'blur(1px)',
          }} />
          <div style={{
            position: 'absolute',
            top: '30%',
            left: '30%',
            width: '15%',
            height: '15%',
            borderRadius: '50%',
            background: 'white',
            opacity: 0.5,
          }} />
        </div>
      </div>

    </div>
  );
};

export default OphanimIndicator;

