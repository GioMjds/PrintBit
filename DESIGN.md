---
name: PrintBit
description: A Windows-based, coin-operated self-service kiosk.
colors:
  primary-indigo: '#696fc7'
  secondary-lavender: '#a7aae1'
  tertiary-peach: '#f5d3c4'
  tertiary-pink: '#f2aebb'
  deep-space-blue: '#0e0d1f'
  surface-white: '#ffffff'
  ink-dark: '#2c2b4b'
  ink-muted: '#7a788f'
  focus-ring: '#f5d3c4'
typography:
  display:
    fontFamily: "'Plus Jakarta Sans', sans-serif"
    fontWeight: 800
  headline:
    fontFamily: "'Plus Jakarta Sans', sans-serif"
    fontWeight: 700
  body:
    fontFamily: "'Plus Jakarta Sans', sans-serif"
    fontWeight: 400
rounded:
  sm: '16px'
  md: '22px'
  lg: '28px'
  full: '999px'
spacing:
  sm: '16px'
  md: '24px'
  lg: '36px'
  xl: '64px'
components:
  action-card:
    backgroundColor: 'linear-gradient(145deg, rgba(105, 111, 199, 0.22) 0%, rgba(105, 111, 199, 0.08) 100%)'
    textColor: '{colors.secondary-lavender}'
    rounded: '{rounded.lg}'
    padding: 'clamp(36px, 4.5vw, 64px) clamp(24px, 3vw, 48px)'
---

# Design System: PrintBit

## Overview

## **Creative North Star: "The Midnight Interface"**

Sleek, glassy, high-contrast, and operational. The PrintBit visual system is built for a dark, immersive kiosk environment. It relies on a deep space background contrasted by vibrant, glowing accents and frosted glass components. The UI is designed to be highly legible from a distance while feeling tactile and dimensional up close.

**Key Characteristics:**

- **Dark Mode Native:** The UI lives entirely in a dark theme, using depth and glow rather than flat colors.
- **Glassy & Tactile:** Components use semi-transparent backgrounds, inner shadows, and blur effects to feel layered.
- **Vibrant Accents:** Neon-inspired indigo, pink, and peach guide the user's attention.

## Colors

The palette is anchored by a deep space background, accented by glowing, energetic hues.

### Primary

- **Electric Indigo** (#696fc7): The primary interactive color, used for the main Print action and active states.

### Secondary

- **Soft Lavender** (#a7aae1): A supporting cool tone used for secondary text and subtle accents.

### Tertiary

- **Neon Pink** (#f2aebb): High-energy accent used for the Scan action.
- **Warm Peach** (#f5d3c4): Used for the Copy action and focus rings.

### Neutral

- **Deep Space Blue** (#0e0d1f): The foundational background color.
- **Surface White** (#ffffff): High-contrast text and primary icons.
- **Muted Ink** (#7a788f): Used for secondary labels, hints, and disabled states.

**The Glow-Over-Fill Rule.** Interactive elements prefer semi-transparent fills with vibrant borders and glowing drop shadows over flat, solid backgrounds.

## Typography

**Display Font:** Plus Jakarta Sans
**Body Font:** Plus Jakarta Sans

**Character:** Clean, geometric, and modern, offering excellent legibility on digital screens.

### Hierarchy

- **Display** (800, clamp(26px, 3.2vw, 46px)): Large action card titles and primary kiosk headings.
- **Headline** (700, 24px): Modal titles and step-by-step headers.
- **Body** (400, 16px): General instructional text and hints.
- **Label** (500, 14px): Small UI labels, uppercase hints.

**The Tabular Time Rule.** Clock and timer numerals must use `font-variant-numeric: tabular-nums` to prevent horizontal jitter during countdowns.

## Layout

The layout is built around a centralized, focused action area. A 3-column grid (`repeat(3, 1fr)`) holds the primary actions on desktop, gracefully collapsing to a single column on smaller/mobile viewports. Padding is generous (e.g., 64px on large screens) to ensure touch targets are isolated.

## Elevation & Depth

The system uses a hybrid of frosted glass (backdrop blur) and colored ambient glows to establish depth against the dark background.

### Shadow Vocabulary

- **Interactive Glow** (`0 8px 32px rgba(0, 0, 0, 0.35)`): Base shadow for large action cards.
- **Active Hover Glow** (`0 20px 56px rgba(105, 111, 199, 0.35)`): A colored, lifted shadow applied when hovering or focusing action cards.
- **Modal Depth** (`0 28px 72px rgba(0, 0, 0, 0.65)`): Heavy drop shadow to separate floating modals from the background.

**The Inner Bevel Rule.** Large tactile surfaces include a subtle inner top-border highlight (`inset 0 1px 0 rgba(255, 255, 255, 0.07)`) to catch the light and enhance dimensionality.

## Shapes

Forms are highly rounded, reinforcing a friendly, touchable hardware interface. Action cards and modals use a large 28px radius, while smaller buttons and icons use 16px to 22px. Floating action buttons (FABs) are perfectly circular (999px).

## Components

Tactile and dimensional, begging to be tapped.

### Action Cards (Print, Copy, Scan)

- **Shape:** Large rounded rectangle (28px).
- **Background:** Semi-transparent tinted gradient with a backdrop blur.
- **Hover / Focus:** Lifts up (`translateY(-6px)`), increases the colored drop shadow, and reveals an inner radial glow.

### Floating Action Buttons (FABs)

- **Shape:** Pill or circular (999px radius).
- **Style:** Semi-transparent background with a delicate border (`rgba(255, 255, 255, 0.28)`) and backdrop blur.

### Modals & Overlays

- **Corner Style:** 28px radius.
- **Background:** Solid dark tones (`#1a1829` or `#181730`) with a colored accent border (e.g., `#ff6b3d` for warnings).
- **Shadow Strategy:** Heavy Modal Depth.

## Do's and Don'ts

### Do

- **Do** use `Plus Jakarta Sans` for all UI text to maintain the modern, geometric feel.
- **Do** ensure interactive elements have a minimum touch target size of 44x44px.
- **Do** use backdrop blur behind floating overlays and modals to maintain context.

### Don't

- **Don't** use solid white or light backgrounds for large structural areas; the UI must remain dark-mode native.
- **Don't** rely on flat shadows; use colored glows that match the element's accent hue.
