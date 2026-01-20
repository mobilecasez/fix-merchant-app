import React, { useEffect, useState } from 'react';
import { Box, Text } from '@shopify/polaris';
import '../styles/shopflix-loader.css';

interface ShopFlixLoaderProps {
  isVisible: boolean;
  currentStep: string;
  progress: number;
}

export default function ShopFlixLoader({ isVisible, currentStep, progress }: ShopFlixLoaderProps) {
  const [dots, setDots] = useState('');

  useEffect(() => {
    if (!isVisible) return;
    
    const interval = setInterval(() => {
      setDots(prev => prev.length >= 3 ? '' : prev + '.');
    }, 500);

    return () => clearInterval(interval);
  }, [isVisible]);

  if (!isVisible) return null;

  return (
    <div className="shopflix-loader-overlay">
      <div className="shopflix-loader-content">
        <div className="shopflix-logo">
          <span className="shopflix-shop">Shop</span>
          <span className="shopflix-flix">Flix</span>
        </div>
        
        <div className="shopflix-processing">
          Processing{dots}
        </div>

        <div className="shopflix-progress-bar">
          <div 
            className="shopflix-progress-fill" 
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="shopflix-progress-text">
          {progress}%
        </div>

        <div className="shopflix-status">
          {currentStep}
        </div>
      </div>
    </div>
  );
}
