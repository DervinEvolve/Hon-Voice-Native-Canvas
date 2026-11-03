import React from 'react';

interface SegmentedButtonOption {
  value: string;
  label: string;
}

interface SegmentedButtonsProps {
  options: SegmentedButtonOption[];
  value: string;
  onChange: (value: string) => void;
  idPrefix: string;
}

export const SegmentedButtons: React.FC<SegmentedButtonsProps> = ({ 
  options, 
  value, 
  onChange, 
  idPrefix 
}) => {
  return (
    <div className="inline-flex rounded-md shadow-sm" role="group">
      {options.map((option, index) => (
        <button
          key={option.value}
          type="button"
          id={`${idPrefix}-${option.value}`}
          className={`px-4 py-2 text-sm font-medium border border-gray-300 dark:border-gray-600 focus:z-10 focus:ring-2 focus:ring-purple-500 focus:text-purple-700 dark:focus:text-white dark:focus:ring-purple-500
            ${
              value === option.value
                ? 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-white'
                : 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'
            }
            ${
              index === 0
                ? 'rounded-l-lg'
                : ''
            }
            ${
              index === options.length - 1
                ? 'rounded-r-lg'
                : '-ml-px' // Prevents double borders
            }
          `}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}; 