import React, { useEffect, useState } from 'react';
import { Box, Text } from '@shopify/polaris';
import '../styles/shopflix-loader.css';

interface ShopFlixLoaderProps {
  isVisible: boolean;
  currentStep: string;
  progress: number;
}

export default function ShopFlixLoader({ isVisible, currentStep, progress }: ShopFlixLoaderProps) {
  if (!isVisible) return null;

  const shopLetters = ['S', 'h', 'o', 'p'];
  const flixLetters = ['F', 'l', 'i', 'x'];

  return (
    <div className="shopflix-loader-overlay">
      <div className="shopflix-loader-content">
        <div className="shopflix-logo">
          <span className="shopflix-shop">
            {shopLetters.map((letter, index) => (
              <span 
                key={`shop-${index}`} 
                className="shopflix-letter"
                style={{ animationDelay: `${index * 0.1}s` }}
              >
                {letter}
              </span>
            ))}
          </span>
          <span className="shopflix-flix">
            {flixLetters.map((letter, index) => (
              <span 
                key={`flix-${index}`} 
                className="shopflix-letter"
                style={{ animationDelay: `${(index + shopLetters.length) * 0.1}s` }}
              >
                {letter}
              </span>
            ))}
          </span>
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
