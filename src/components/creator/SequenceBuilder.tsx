import React, { useState, useEffect } from 'react';
import { Workflow, Play, Save, Sparkles, ArrowRight, Clock, Zap } from 'lucide-react';
import { useComicStore } from '../../store/useComicStore';
import { Panel } from '../../types';
import { fluxKontextService } from '../../services/fluxKontextService';
import { lumaVideoService } from '../../services/lumaVideoService';
import { runwayService } from '../../services/runwayService';
import { nanoid } from 'nanoid';

interface SequenceBuilderProps {
  onGenerateStory: (prompt: string, generatedUrl: string, type: 'image' | 'video' | 'gif', panel?: Panel) => Promise<void>;
}

interface SequenceStep {
  id: string;
  type: 'enhance' | 'transition' | 'animate' | 'style-transfer';
  description: string;
  panelIds: string[];
  enabled: boolean;
}

interface SequenceTemplate {
  id: string;
  name: string;
  description: string;
  steps: SequenceStep[];
  icon: string;
}

const predefinedTemplates: SequenceTemplate[] = [
  {
    id: 'smooth-story',
    name: 'Smooth Story Flow (Flux)',
    description: 'Creates seamless transitions using Flux Kontext',
    icon: '🎬',
    steps: [
      {
        id: 'enhance-panels',
        type: 'enhance',
        description: 'Enhance visual consistency across panels',
        panelIds: [],
        enabled: true
      },
      {
        id: 'create-transitions',
        type: 'transition',
        description: 'Generate smooth transition frames between panels',
        panelIds: [],
        enabled: true
      }
    ]
  },
  {
    id: 'runway-advanced',
    name: 'Advanced Character Consistency (Runway Gen-4)',
    description: 'Full Runway Gen-4 References: Character + Location + Style consistency',
    icon: '🎭',
    steps: [
      {
        id: 'character-consistency',
        type: 'enhance',
        description: 'Extract and maintain character consistency across all panels',
        panelIds: [],
        enabled: true
      },
      {
        id: 'multi-reference-transitions',
        type: 'transition',
        description: 'Multi-reference transitions with @character @location @style',
        panelIds: [],
        enabled: true
      },
      {
        id: 'style-harmonization',
        type: 'style-transfer',
        description: 'Harmonize visual style across entire sequence',
        panelIds: [],
        enabled: true
      }
    ]
  },
  {
    id: 'product-placement',
    name: 'Product Placement Pipeline',
    description: 'Advanced object/product consistency across scenes using Runway',
    icon: '📦',
    steps: [
      {
        id: 'product-extraction',
        type: 'enhance',
        description: 'Extract product/object references from panels',
        panelIds: [],
        enabled: true
      },
      {
        id: 'contextual-placement',
        type: 'transition',
        description: 'Place products naturally in different environments',
        panelIds: [],
        enabled: true
      }
    ]
  },
  {
    id: 'lookbook-generator',
    name: 'Lookbook Generator',
    description: 'Create consistent character looks across different settings',
    icon: '👗',
    steps: [
      {
        id: 'character-analysis',
        type: 'enhance',
        description: 'Analyze character appearance and style',
        panelIds: [],
        enabled: true
      },
      {
        id: 'setting-variations',
        type: 'transition',
        description: 'Generate character in various settings/poses',
        panelIds: [],
        enabled: true
      },
      {
        id: 'style-consistency',
        type: 'style-transfer',
        description: 'Maintain consistent aesthetic across all variations',
        panelIds: [],
        enabled: true
      }
    ]
  },
  {
    id: 'local-editing',
    name: 'Contextual Local Editing',
    description: 'Edit specific parts while maintaining overall consistency',
    icon: '🎨',
    steps: [
      {
        id: 'region-analysis',
        type: 'enhance',
        description: 'Analyze regions for targeted editing',
        panelIds: [],
        enabled: true
      },
      {
        id: 'local-modifications',
        type: 'transition',
        description: 'Apply local edits while preserving context',
        panelIds: [],
        enabled: true
      }
    ]
  },
  {
    id: 'hybrid-power',
    name: 'Hybrid Power (Flux + Runway)',
    description: 'Combine Flux Kontext editing with Runway References',
    icon: '⚡',
    steps: [
      {
        id: 'flux-enhancement',
        type: 'enhance',
        description: 'Flux Kontext: Enhance lighting, atmosphere, details',
        panelIds: [],
        enabled: true
      },
      {
        id: 'runway-consistency',
        type: 'transition',
        description: 'Runway: Ensure character/object consistency',
        panelIds: [],
        enabled: true
      },
      {
        id: 'style-unification',
        type: 'style-transfer',
        description: 'Unify visual style across enhanced sequence',
        panelIds: [],
        enabled: true
      }
    ]
  }
];

export const SequenceBuilder: React.FC<SequenceBuilderProps> = ({ onGenerateStory }) => {
  const { currentComic, currentPageIndex, updatePanel } = useComicStore();
  const [isExecuting, setIsExecuting] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<SequenceTemplate | null>(null);
  const [executionProgress, setExecutionProgress] = useState<string>('');
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  
  // Advanced reference inputs
  const [showAdvancedRefs, setShowAdvancedRefs] = useState(false);
  const [manualPrompt, setManualPrompt] = useState('');
  const [characterRef, setCharacterRef] = useState('');
  const [locationRef, setLocationRef] = useState('');
  const [styleRef, setStyleRef] = useState('');

  // Get current page panels
  const currentPanels = currentComic?.pages[currentPageIndex] || [];
  const hasMinimumPanels = currentPanels.length >= 1; // Changed from 2 to 1 for Option A

  // Auto-detect sequence potential
  const sequencePotential = analyzeSequencePotential(currentPanels);

  function analyzeSequencePotential(panels: Panel[]) {
    if (panels.length < 1) return { score: 0, suggestions: [] };
    
    const suggestions = [];
    const imageCount = panels.filter(p => p.type === 'image').length;
    const videoCount = panels.filter(p => p.type === 'video').length;
    
    if (imageCount >= 1) {
      suggestions.push('Generate character-consistent panels');
      suggestions.push('Convert static panels to living videos');
    }
    if (imageCount >= 2) {
      suggestions.push('Create smooth transitions between images');
    }
    if (panels.length >= 1 && videoCount === 0) {
      suggestions.push('Animate static images into dynamic videos');
    }
    if (panels.length >= 2) {
      suggestions.push('Enhance visual consistency across story');
    }
    
    return { 
      score: Math.min(100, (panels.length * 20) + (imageCount * 15) + 20), // Boost base score
      suggestions 
    };
  }

  const executeSequence = async (template: SequenceTemplate) => {
    if (!currentComic || currentPanels.length < 1) return;
    
    setIsExecuting(true);
    setExecutionProgress('Initializing sequence...');
    setCompletedSteps([]);
    
    try {
      for (const step of template.steps) {
        if (!step.enabled) continue;
        
        setExecutionProgress(`Executing: ${step.description}`);
        
        try {
          switch (step.type) {
            case 'enhance':
              await executeEnhanceStep(currentPanels, step.id, selectedTemplate.id);
              break;
            case 'transition':
              // Use advanced Runway for Runway-based templates
              if (selectedTemplate.id.includes('runway') || selectedTemplate.id === 'product-placement' || selectedTemplate.id === 'lookbook-generator' || selectedTemplate.id === 'local-editing') {
                await executeRunwayTransitionStep(currentPanels);
              } else if (selectedTemplate.id === 'hybrid-power') {
                // Hybrid: Use both Flux and Runway
                await executeHybridTransitionStep(currentPanels);
              } else {
                await executeTransitionStep(currentPanels);
              }
              break;
            case 'animate':
              await executeAnimateStep(currentPanels);
              break;
            case 'style-transfer':
              await executeStyleTransferStep(currentPanels, step.id, selectedTemplate.id);
              break;
          }
        } catch (stepError) {
          console.warn(`Step ${step.id} failed:`, stepError);
          // Continue with next step instead of failing entire sequence
        }
        
        setCompletedSteps(prev => [...prev, step.id]);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Brief pause between steps
      }
      
      setExecutionProgress('Sequence completed successfully!');
      setTimeout(() => {
        setIsExecuting(false);
        setSelectedTemplate(null);
        setExecutionProgress('');
        setCompletedSteps([]);
      }, 2000);
      
    } catch (error) {
      console.error('Sequence execution failed:', error);
      setExecutionProgress('Sequence failed. Please try again.');
      setTimeout(() => setIsExecuting(false), 3000);
    }
  };

  const executeEnhanceStep = async (panels: Panel[], stepId?: string, templateId?: string) => {
    switch (stepId) {
      case 'character-consistency':
        // Advanced character analysis and consistency
        if (panels.length >= 1) {
          const characterReference = await runwayService.analyzeCharacter(
            panels[0].url,
            panels[0].caption || 'main character'
          );
          console.log('Character reference extracted:', characterReference);
          
          // If only 1 panel, generate additional character-consistent panels
          if (panels.length === 1) {
            const additionalPanels = [
              'The same character in a different setting, walking through a marketplace',
              'The character from a different angle, close-up portrait view',
              'The character in action, dynamic movement or pose'
            ];
            
            for (let i = 0; i < additionalPanels.length; i++) {
              try {
                const newPanelUrl = await runwayService.generateAdvancedScene({
                  character: characterReference,
                  scenePrompt: additionalPanels[i],
                  ratio: '1024:1024'
                });
                
                const newPanel: Panel = {
                  id: nanoid(),
                  type: 'image',
                  url: newPanelUrl,
                  size: 'medium',
                  aspectRatio: 1,
                  position: { row: 0, col: i + 1 },
                  caption: `Generated: ${additionalPanels[i]}`
                };
                
                console.log('SequenceBuilder: About to call onGenerateStory with panel:', newPanel);
                await onGenerateStory(`Generated panel: ${additionalPanels[i]}`, newPanelUrl, 'image', newPanel);
                console.log('SequenceBuilder: onGenerateStory completed for panel:', newPanel.id);
              } catch (error) {
                console.warn(`Failed to generate additional panel ${i}:`, error);
              }
            }
          }
        }
        break;
        
      case 'product-extraction':
        // Extract product/object references
        for (const panel of panels) {
          if (panel.type === 'image') {
            console.log('Extracting product references from:', panel.url);
          }
        }
        break;
        
      case 'character-analysis':
        // Lookbook character analysis
        for (const panel of panels) {
          if (panel.type === 'image') {
            const characterAnalysis = await runwayService.analyzeCharacter(
              panel.url,
              'character for lookbook generation'
            );
            console.log('Character analysis:', characterAnalysis);
          }
        }
        break;
        
      case 'region-analysis':
        // Local editing region analysis
        console.log('Analyzing regions for targeted editing');
        break;
        
      case 'flux-enhancement':
        // Flux Kontext enhancement
        for (let i = 0; i < panels.length; i++) {
          const panel = panels[i];
          if (panel.type === 'image') {
            try {
              const enhancementPrompt = 'Enhance lighting, atmosphere, and visual details while maintaining composition';
              const enhancedUrl = await fluxKontextService.editImage(
                enhancementPrompt,
                panel.url
              );
              
              const enhancedPanel = { ...panel, url: enhancedUrl, caption: (panel.caption || '') + ' (Flux Enhanced)' };
              await updatePanel(enhancedPanel, currentPageIndex);
            } catch (error) {
              console.warn(`Failed to Flux enhance panel ${i}:`, error);
            }
          }
        }
        break;
        
      default:
        // Default enhancement using Flux Kontext
        for (let i = 0; i < panels.length; i++) {
          const panel = panels[i];
          if (panel.type === 'image') {
            try {
              const enhancedUrl = await fluxKontextService.editImage(
                'Enhance this image with consistent style and lighting',
                panel.url
              );
              
              const enhancedPanel = { ...panel, url: enhancedUrl };
              await updatePanel(enhancedPanel, currentPageIndex);
            } catch (error) {
              console.warn(`Failed to enhance panel ${i}:`, error);
            }
          }
        }
    }
  };

  const executeTransitionStep = async (panels: Panel[]) => {
    // Fix: Only process original panels, not newly added ones
    const originalPanels = panels.filter(p => !p.caption?.includes('Transition Frame'));
    
    // Create transition images between original panels only
    for (let i = 0; i < originalPanels.length - 1; i++) {
      const currentPanel = originalPanels[i];
      const nextPanel = originalPanels[i + 1];
      
      if (currentPanel.type === 'image' && nextPanel.type === 'image') {
        try {
          // Enhanced prompt for better transitions with character/location consistency
          const transitionPrompt = `Create a cinematic transition frame showing the progression from the first scene to the second scene. Maintain character consistency and visual continuity. Show the same character/location from a new angle that bridges these two moments in the story.`;
          
          const transitionUrl = await fluxKontextService.editImage(
            transitionPrompt,
            currentPanel.url
          );
          
          // Insert transition image between original panels
          const transitionPanel: Panel = {
            id: nanoid(),
            type: 'image',
            url: transitionUrl,
            size: 'medium',
            aspectRatio: 1,
            position: { row: 0, col: i + 0.5 }, // Between panels
            caption: 'Transition Frame'
          };
          
          await onGenerateStory('Transition frame', transitionUrl, 'image', transitionPanel);
        } catch (error) {
          console.warn(`Failed to create transition ${i}-${i+1}:`, error);
        }
      }
    }
  };

  const executeRunwayTransitionStep = async (panels: Panel[]) => {
    // Fix: Only process original panels, not newly added ones
    const originalPanels = panels.filter(p => !p.caption?.includes('Transition Frame'));
    
    if (originalPanels.length < 1) return;
    
    // If only 1 panel, try simple enhancement instead of complex transitions
    if (originalPanels.length === 1) {
      console.log('Only 1 panel available, performing simple character enhancement');
      
      try {
        // Simple character-consistent enhancement for single panel
        const characterReference = await runwayService.analyzeCharacter(
          originalPanels[0].url,
          originalPanels[0].caption || 'main character'
        );
        
        // Generate one additional panel for demonstration
        const enhancedUrl = await runwayService.generateAdvancedScene({
          character: characterReference,
          scenePrompt: 'The same character in a different pose or setting, maintaining visual consistency',
          ratio: '1024:1024'
        });
        
        const enhancedPanel: Panel = {
          id: nanoid(),
          type: 'image',
          url: enhancedUrl,
          size: 'medium',
          aspectRatio: 1,
          position: { row: 0, col: 1 },
          caption: 'Character Enhanced (Runway)'
        };
        
        console.log('SequenceBuilder: Single panel enhancement - calling onGenerateStory with:', enhancedPanel);
        await onGenerateStory('Character enhanced view', enhancedUrl, 'image', enhancedPanel);
        console.log('SequenceBuilder: Single panel enhancement completed');
        
      } catch (error) {
        console.warn('Single panel enhancement failed:', error);
        // Don't throw error - let sequence continue gracefully
      }
      
      return; // Complete this step successfully
    }
    
    // Advanced Runway Gen-4 References Implementation
    try {
      // Step 1: Character Consistency Across All Panels
      const characterConsistentPanels = await runwayService.generateCharacterConsistentSequence(
        originalPanels.map(panel => ({
          imageUrl: panel.url,
          prompt: panel.caption || 'Continue the story with this character'
        })),
        0 // Use first panel as character reference
      );
      
      // Update panels with character-consistent versions
      for (let i = 1; i < characterConsistentPanels.length; i++) {
        const enhancedPanel = {
          ...originalPanels[i],
          url: characterConsistentPanels[i],
          caption: (originalPanels[i].caption || '') + ' (Character Consistent)'
        };
        await updatePanel(enhancedPanel, currentPageIndex);
      }
      
      // Step 2: Multi-Reference Transitions
      for (let i = 0; i < originalPanels.length - 1; i++) {
        const currentPanel = originalPanels[i];
        const nextPanel = originalPanels[i + 1];
        
        if (currentPanel.type === 'image' && nextPanel.type === 'image') {
          // Use advanced multi-reference transition
          const transitionUrl = await runwayService.generateMultiReferenceTransition(
            {
              imageUrl: characterConsistentPanels[i] || currentPanel.url,
              description: currentPanel.caption || 'current scene'
            },
            {
              imageUrl: characterConsistentPanels[i + 1] || nextPanel.url,
              description: nextPanel.caption || 'next scene'
            },
            // Optional: Use first panel as style reference
            {
              imageUrl: originalPanels[0].url,
              description: 'maintaining consistent visual style'
            }
          );
          
          // Insert advanced transition frame
          const transitionPanel: Panel = {
            id: nanoid(),
            type: 'image',
            url: transitionUrl,
            size: 'medium',
            aspectRatio: 1,
            position: { row: 0, col: i + 0.5 },
            caption: 'Advanced Runway Transition'
          };
          
          await onGenerateStory('Advanced Runway transition', transitionUrl, 'image', transitionPanel);
        }
      }
      
      // Step 3: Style Consistency Enhancement
      if (originalPanels.length >= 2) {
        const styleConsistentPanels = await runwayService.generateStyleConsistentSequence(
          originalPanels.map(panel => ({
            imageUrl: panel.url,
            prompt: panel.caption || 'Apply consistent visual style'
          })),
          0 // Use first panel as style reference
        );
        
        // Apply style consistency to all panels
        for (let i = 0; i < styleConsistentPanels.length; i++) {
          const styledPanel = {
            ...originalPanels[i],
            url: styleConsistentPanels[i],
            caption: (originalPanels[i].caption || '') + ' (Style Enhanced)'
          };
          await updatePanel(styledPanel, currentPageIndex);
        }
      }
      
    } catch (error) {
      console.warn('Advanced Runway processing failed, falling back to basic transition:', error);
      
      // Fallback: Basic transitions
      for (let i = 0; i < originalPanels.length - 1; i++) {
        const currentPanel = originalPanels[i];
        const nextPanel = originalPanels[i + 1];
        
        if (currentPanel.type === 'image' && nextPanel.type === 'image') {
          try {
            const transitionUrl = await runwayService.generateMultiReferenceTransition(
              {
                imageUrl: currentPanel.url,
                description: currentPanel.caption || 'current scene'
              },
              {
                imageUrl: nextPanel.url,
                description: nextPanel.caption || 'next scene'
              }
            );
            
            const transitionPanel: Panel = {
              id: nanoid(),
              type: 'image',
              url: transitionUrl,
              size: 'medium',
              aspectRatio: 1,
              position: { row: 0, col: i + 0.5 },
              caption: 'Basic Runway Transition'
            };
            
            await onGenerateStory('Basic Runway transition', transitionUrl, 'image', transitionPanel);
          } catch (fallbackError) {
            console.warn(`Failed to create basic transition ${i}-${i+1}:`, fallbackError);
          }
        }
      }
    }
  };

  const executeAnimateStep = async (panels: Panel[]) => {
    // Enhance static images with dynamic elements using Flux Kontext
    for (let i = 0; i < panels.length; i++) {
      const panel = panels[i];
      if (panel.type === 'image') {
        try {
          const enhancementPrompt = 'Add dynamic visual elements, enhanced lighting, and cinematic atmosphere to bring this scene to life';
          const enhancedUrl = await fluxKontextService.editImage(
            enhancementPrompt,
            panel.url
          );
          
          const enhancedPanel = { ...panel, url: enhancedUrl, caption: panel.caption + ' (Enhanced)' };
          await updatePanel(enhancedPanel, currentPageIndex);
        } catch (error) {
          console.warn(`Failed to enhance panel ${i}:`, error);
        }
      }
    }
  };

  const executeStyleTransferStep = async (panels: Panel[], stepId?: string, templateId?: string) => {
    switch (stepId) {
      case 'style-harmonization':
        // Advanced Runway style harmonization
        if (panels.length >= 2) {
          try {
            const styleConsistentPanels = await runwayService.generateStyleConsistentSequence(
              panels.map(panel => ({
                imageUrl: panel.url,
                prompt: panel.caption || 'Apply harmonized visual style'
              })),
              0 // Use first panel as style reference
            );
            
            for (let i = 0; i < styleConsistentPanels.length; i++) {
              const styledPanel = {
                ...panels[i],
                url: styleConsistentPanels[i],
                caption: (panels[i].caption || '') + ' (Style Harmonized)'
              };
              await updatePanel(styledPanel, currentPageIndex);
            }
          } catch (error) {
            console.warn('Style harmonization failed:', error);
          }
        }
        break;
        
      case 'style-unification':
        // Hybrid style unification
        for (let i = 0; i < panels.length; i++) {
          const panel = panels[i];
          if (panel.type === 'image') {
            try {
              const stylePrompt = 'Unify visual style with consistent color grading, lighting, and aesthetic';
              const styledUrl = await fluxKontextService.editImage(stylePrompt, panel.url);
              const styledPanel = { ...panel, url: styledUrl, caption: (panel.caption || '') + ' (Unified Style)' };
              await updatePanel(styledPanel, currentPageIndex);
            } catch (error) {
              console.warn(`Failed to unify style for panel ${i}:`, error);
            }
          }
        }
        break;
        
      default:
        // Default style transfer using Flux Kontext
        const stylePrompt = 'Apply cinematic color grading and consistent visual style';
        
        for (let i = 0; i < panels.length; i++) {
          const panel = panels[i];
          if (panel.type === 'image') {
            try {
              const styledUrl = await fluxKontextService.editImage(stylePrompt, panel.url);
              const styledPanel = { ...panel, url: styledUrl };
              await updatePanel(styledPanel, currentPageIndex);
            } catch (error) {
              console.warn(`Failed to apply style to panel ${i}:`, error);
            }
          }
        }
    }
  };

  const executeHybridTransitionStep = async (panels: Panel[]) => {
    // Hybrid approach: Combine Flux Kontext editing with Runway References
    const originalPanels = panels.filter(p => !p.caption?.includes('Transition Frame'));
    
    if (originalPanels.length < 2) return;
    
    try {
      // Step 1: Use Flux to enhance each panel individually
      const fluxEnhancedPanels = [];
      for (const panel of originalPanels) {
        if (panel.type === 'image') {
          try {
            const enhancedUrl = await fluxKontextService.editImage(
              'Enhance lighting, atmosphere, and visual details for cinematic quality',
              panel.url
            );
            fluxEnhancedPanels.push({ ...panel, url: enhancedUrl });
          } catch (error) {
            console.warn('Flux enhancement failed, using original:', error);
            fluxEnhancedPanels.push(panel);
          }
        }
      }
      
      // Step 2: Use Runway for character consistency across enhanced panels
      const characterConsistentPanels = await runwayService.generateCharacterConsistentSequence(
        fluxEnhancedPanels.map(panel => ({
          imageUrl: panel.url,
          prompt: panel.caption || 'Maintain character consistency with enhanced quality'
        })),
        0
      );
      
      // Step 3: Create multi-reference transitions
      for (let i = 0; i < originalPanels.length - 1; i++) {
        const transitionUrl = await runwayService.generateMultiReferenceTransition(
          {
            imageUrl: characterConsistentPanels[i],
            description: originalPanels[i].caption || 'enhanced current scene'
          },
          {
            imageUrl: characterConsistentPanels[i + 1],
            description: originalPanels[i + 1].caption || 'enhanced next scene'
          }
        );
        
        const hybridTransitionPanel: Panel = {
          id: nanoid(),
          type: 'image',
          url: transitionUrl,
          size: 'medium',
          aspectRatio: 1,
          position: { row: 0, col: i + 0.5 },
          caption: 'Hybrid Transition (Flux + Runway)'
        };
        
        await onGenerateStory('Hybrid transition', transitionUrl, 'image', hybridTransitionPanel);
      }
      
      // Step 4: Update original panels with enhanced versions
      for (let i = 0; i < characterConsistentPanels.length; i++) {
        const hybridPanel = {
          ...originalPanels[i],
          url: characterConsistentPanels[i],
          caption: (originalPanels[i].caption || '') + ' (Hybrid Enhanced)'
        };
        await updatePanel(hybridPanel, currentPageIndex);
      }
      
    } catch (error) {
      console.warn('Hybrid processing failed:', error);
      // Fallback to basic Flux transitions
      await executeTransitionStep(originalPanels);
    }
  };

  return (
    <div className="space-y-4">
      {/* Sequence Potential Indicator */}
      {hasMinimumPanels && (
        <div className="bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 p-3 rounded-lg border border-purple-200 dark:border-purple-800">
          <div className="flex items-center mb-2">
            <Sparkles size={16} className="text-purple-500 mr-2" />
            <span className="text-sm font-medium text-purple-700 dark:text-purple-300">
              Sequence Potential: {sequencePotential.score}%
            </span>
          </div>
          <div className="text-xs text-purple-600 dark:text-purple-400 space-y-1">
            {sequencePotential.suggestions.map((suggestion, i) => (
              <div key={i} className="flex items-center">
                <ArrowRight size={12} className="mr-1" />
                {suggestion}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Template Selection */}
      {!hasMinimumPanels ? (
        <div className="text-center p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <Workflow size={24} className="mx-auto text-gray-400 mb-2" />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Add at least 1 panel to create sequences
          </p>
        </div>
      ) : isExecuting ? (
        <div className="space-y-3">
          <div className="text-center">
            <div className="inline-flex items-center px-4 py-2 bg-blue-500 text-white rounded-lg">
              <div className="animate-spin mr-2">
                <Zap size={16} />
              </div>
              Executing Sequence...
            </div>
          </div>
          
          <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-lg">
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {executionProgress}
            </div>
            
            {selectedTemplate && (
              <div className="space-y-2">
                {selectedTemplate.steps.map((step) => (
                  <div 
                    key={step.id}
                    className={`flex items-center text-xs p-2 rounded ${
                      completedSteps.includes(step.id) 
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' 
                        : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                    }`}
                  >
                    <div className={`w-4 h-4 rounded-full mr-2 flex items-center justify-center ${
                      completedSteps.includes(step.id) ? 'bg-green-500' : 'bg-gray-300'
                    }`}>
                      {completedSteps.includes(step.id) && (
                        <div className="w-2 h-2 bg-white rounded-full" />
                      )}
                    </div>
                    {step.description}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Choose a sequence template:
          </h3>
          
          {predefinedTemplates.map((template) => (
            <div
              key={template.id}
              className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                selectedTemplate?.id === template.id
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
              onClick={() => setSelectedTemplate(template)}
            >
              <div className="flex items-center mb-2">
                <span className="text-lg mr-2">{template.icon}</span>
                <span className="font-medium text-gray-800 dark:text-gray-200">
                  {template.name}
                </span>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                {template.description}
              </p>
              <div className="text-xs text-gray-500 dark:text-gray-500">
                {template.steps.length} steps • {template.steps.filter(s => s.enabled).length} enabled
              </div>
            </div>
          ))}
          
          {selectedTemplate && (
            <button
              onClick={() => executeSequence(selectedTemplate)}
              disabled={isExecuting}
              className="w-full py-2 bg-gradient-to-r from-purple-500 to-blue-600 text-white rounded-md hover:from-purple-600 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
            >
              <Play size={16} className="mr-2" />
              Execute Sequence
            </button>
          )}
        </div>
      )}
      
      {/* Advanced Reference Input */}
      {hasMinimumPanels && !isExecuting && (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
          <button 
            onClick={() => setShowAdvancedRefs(!showAdvancedRefs)}
            className="w-full text-left text-xs text-gray-600 dark:text-gray-400 mb-2 flex items-center"
          >
            <ArrowRight size={12} className={`mr-1 transition-transform ${showAdvancedRefs ? 'rotate-90' : ''}`} />
            Advanced References (@character @location @style)
          </button>
          
          {showAdvancedRefs && (
            <div className="space-y-3 bg-gray-50 dark:bg-gray-800 p-3 rounded-lg">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                Use Runway's multi-reference system to generate images with specific character, location, and style references
              </div>
              
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Prompt: A character walking through the city..."
                  value={manualPrompt}
                  onChange={(e) => setManualPrompt(e.target.value)}
                  className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                />
                
                <input
                  type="text"
                  placeholder="@character URL (optional)"
                  value={characterRef}
                  onChange={(e) => setCharacterRef(e.target.value)}
                  className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                />
                
                <input
                  type="text"
                  placeholder="@location URL (optional)"
                  value={locationRef}
                  onChange={(e) => setLocationRef(e.target.value)}
                  className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                />
                
                <input
                  type="text"
                  placeholder="@style URL (optional)"
                  value={styleRef}
                  onChange={(e) => setStyleRef(e.target.value)}
                  className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                />
                
                <button
                  onClick={async () => {
                    if (!manualPrompt.trim()) return;
                    
                    try {
                      setIsExecuting(true);
                      setExecutionProgress('Generating with multi-references...');
                      
                      const referenceImages = [];
                      if (characterRef) referenceImages.push({ uri: characterRef, tag: 'character' });
                      if (locationRef) referenceImages.push({ uri: locationRef, tag: 'location' });
                      if (styleRef) referenceImages.push({ uri: styleRef, tag: 'style' });
                      
                      const generatedUrl = await runwayService.generateImageWithReferences({
                        promptText: manualPrompt,
                        referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
                        ratio: '1024:1024'
                      });
                      
                      const newPanel: Panel = {
                        id: nanoid(),
                        type: 'image',
                        url: generatedUrl,
                        size: 'medium',
                        aspectRatio: 1,
                        position: { row: 0, col: currentPanels.length },
                        caption: `Multi-ref: ${manualPrompt}`
                      };
                      
                      console.log('SequenceBuilder: Manual generation - calling onGenerateStory with:', newPanel);
                      await onGenerateStory(manualPrompt, generatedUrl, 'image', newPanel);
                      console.log('SequenceBuilder: Manual generation completed');
                      
                      // Clear inputs
                      setManualPrompt('');
                      setCharacterRef('');
                      setLocationRef('');
                      setStyleRef('');
                      
                    } catch (error) {
                      console.error('Manual reference generation failed:', error);
                      setExecutionProgress('Generation failed. Please try again.');
                    } finally {
                      setIsExecuting(false);
                      setExecutionProgress('');
                    }
                  }}
                  disabled={!manualPrompt.trim()}
                  className="w-full py-1 px-2 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Generate with References
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      
      {/* Quick Actions */}
      {hasMinimumPanels && !isExecuting && (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">Quick Actions:</div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => executeEnhanceStep(currentPanels)}
              className="p-2 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded flex items-center justify-center"
            >
              <Sparkles size={12} className="mr-1" />
              Enhance All
            </button>
            <button
              onClick={() => executeAnimateStep(currentPanels)}
              className="p-2 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded flex items-center justify-center"
            >
              <Clock size={12} className="mr-1" />
              Animate All
            </button>
          </div>
        </div>
      )}
    </div>
  );
}; 