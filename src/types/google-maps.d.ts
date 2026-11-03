declare global {
  const google: any;

  namespace JSX {
    interface IntrinsicElements {
      'gmp-map-3d': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & {
        'map-id'?: string;
        mode?: 'hybrid' | 'satellite';
        center?: string;
        heading?: string | number;
        tilt?: string | number;
        range?: string | number;
        'default-ui-disabled'?: string | boolean;
      };
      'gmp-model-3d': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & {
        src?: string;
        scale?: string | number;
        position?: string;
        orientation?: string;
        'altitude-mode'?: 'clamp-to-ground' | 'relative-to-ground' | 'relative-to-mesh' | 'absolute';
      };
    }
  }
}

export {};

