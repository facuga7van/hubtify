import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { tourSteps } from './tourSteps';

interface TourContextType {
  isActive: boolean;
  currentStep: number;
  totalSteps: number;
  startTour: () => void;
  nextStep: () => void;
  prevStep: () => void;
  skipTour: () => void;
}

const TourContext = createContext<TourContextType | null>(null);

export function useTour(): TourContextType {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error('useTour must be used within TourProvider');
  return ctx;
}

interface TourProviderProps {
  children: React.ReactNode;
  autoStart?: boolean;
}

const STORAGE_KEY = 'hubtify_toured';
const ONBOARDED_KEY = 'hubtify_onboarded';
const POLL_INTERVAL_MS = 100;
const POLL_TIMEOUT_MS = 2000;

/**
 * Waits for a DOM element matching `[data-tour="${target}"]` to appear.
 * Supports AbortSignal for cleanup on unmount.
 */
function waitForElement(target: string, signal?: AbortSignal): Promise<Element | null> {
  return new Promise((resolve) => {
    const selector = `[data-tour="${target}"]`;

    const el = document.querySelector(selector);
    if (el) { resolve(el); return; }

    if (signal?.aborted) { resolve(null); return; }

    const start = Date.now();
    let rafId: number;
    let timeoutId: ReturnType<typeof setTimeout>;

    const cleanup = () => {
      cancelAnimationFrame(rafId);
      clearTimeout(timeoutId);
    };

    const onAbort = () => { cleanup(); resolve(null); };
    signal?.addEventListener('abort', onAbort, { once: true });

    const poll = () => {
      if (signal?.aborted) return;
      const el = document.querySelector(selector);
      if (el) {
        signal?.removeEventListener('abort', onAbort);
        resolve(el);
        return;
      }
      if (Date.now() - start > POLL_TIMEOUT_MS) {
        signal?.removeEventListener('abort', onAbort);
        resolve(null);
        return;
      }
      rafId = requestAnimationFrame(() => {
        timeoutId = setTimeout(poll, POLL_INTERVAL_MS);
      });
    };

    poll();
  });
}

export function TourProvider({ children, autoStart = true }: TourProviderProps) {
  const [isActive, setIsActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();
  const stepRef = useRef(0);
  const busyRef = useRef(false);
  const navigatingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  // Keep a synchronously-updated ref so navigateToStep always reads fresh pathname
  const locationRef = useRef(location);
  locationRef.current = location;

  const totalSteps = tourSteps.length;

  // Set/clear DOM attribute so other hooks (useKeyboardShortcuts) can check tour state
  useEffect(() => {
    if (isActive) {
      document.body.dataset.tourActive = 'true';
    } else {
      delete document.body.dataset.tourActive;
    }
    return () => { delete document.body.dataset.tourActive; };
  }, [isActive]);

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  // Auto-start: if user completed onboarding but hasn't toured yet
  useEffect(() => {
    if (!autoStart) return;
    const toured = localStorage.getItem(STORAGE_KEY) === 'true';
    const onboarded = localStorage.getItem(ONBOARDED_KEY) === 'true';
    if (onboarded && !toured) {
      const timer = setTimeout(() => {
        stepRef.current = 0;
        navigatingRef.current = true;
        setCurrentStep(0);
        setIsActive(true);
        requestAnimationFrame(() => {
          navigateToStep(0);
        });
      }, 800);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  // Handle account:switched — re-evaluate tour state
  useEffect(() => {
    const handler = () => {
      const toured = localStorage.getItem(STORAGE_KEY) === 'true';
      const onboarded = localStorage.getItem(ONBOARDED_KEY) === 'true';
      if (toured) {
        setIsActive(false);
      } else if (onboarded && autoStart) {
        stepRef.current = 0;
        navigatingRef.current = true;
        setCurrentStep(0);
        setIsActive(true);
        requestAnimationFrame(() => {
          navigateToStep(0);
        });
      }
    };
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  // Handle manual navigation during active tour — cancel if route desyncs
  useEffect(() => {
    if (!isActive || navigatingRef.current) return;
    const step = tourSteps[stepRef.current];
    if (step?.route && location.pathname !== step.route) {
      // User navigated manually away from the tour step's route
      abortRef.current?.abort();
      localStorage.setItem(STORAGE_KEY, 'true');
      setIsActive(false);
      stepRef.current = 0;
      setCurrentStep(0);
    }
  }, [location.pathname, isActive]);

  const completeTour = useCallback(() => {
    abortRef.current?.abort();
    localStorage.setItem(STORAGE_KEY, 'true');
    setIsActive(false);
    stepRef.current = 0;
    setCurrentStep(0);
  }, []);

  const navigateToStep = useCallback(async (stepIndex: number) => {
    const step = tourSteps[stepIndex];
    if (!step) return;

    // Cancel any in-flight polling
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Read fresh pathname from ref (not stale closure)
    const currentPath = locationRef.current.pathname;

    if (step.route && currentPath !== step.route) {
      navigatingRef.current = true;
      navigate(step.route);
      const el = await waitForElement(step.target, controller.signal);
      navigatingRef.current = false;
      if (!el && !controller.signal.aborted) {
        console.warn(`[Tour] Element [data-tour="${step.target}"] not found after navigation to ${step.route}`);
      }
    } else {
      navigatingRef.current = false;
      const el = await waitForElement(step.target, controller.signal);
      if (!el && !controller.signal.aborted) {
        console.warn(`[Tour] Element [data-tour="${step.target}"] not found on ${currentPath}`);
      }
    }
  }, [navigate]);

  const startTour = useCallback(() => {
    stepRef.current = 0;
    // Set navigating BEFORE isActive to prevent manual navigation detection from firing
    navigatingRef.current = true;
    setCurrentStep(0);
    setIsActive(true);
    // Defer navigation so isActive renders first (avoids flash of un-overlaid page)
    requestAnimationFrame(() => {
      navigateToStep(0);
    });
  }, [navigateToStep]);

  const nextStep = useCallback(async () => {
    if (busyRef.current) return;
    const next = stepRef.current + 1;
    if (next >= totalSteps) {
      completeTour();
      return;
    }
    busyRef.current = true;
    stepRef.current = next;
    setCurrentStep(next);
    try {
      await navigateToStep(next);
    } finally {
      busyRef.current = false;
    }
  }, [totalSteps, completeTour, navigateToStep]);

  const prevStep = useCallback(async () => {
    if (busyRef.current) return;
    const prev = stepRef.current - 1;
    if (prev < 0) return;
    busyRef.current = true;
    stepRef.current = prev;
    setCurrentStep(prev);
    try {
      await navigateToStep(prev);
    } finally {
      busyRef.current = false;
    }
  }, [navigateToStep]);

  const skipTour = useCallback(() => {
    completeTour();
  }, [completeTour]);

  const value = useMemo<TourContextType>(() => ({
    isActive,
    currentStep,
    totalSteps,
    startTour,
    nextStep,
    prevStep,
    skipTour,
  }), [isActive, currentStep, totalSteps, startTour, nextStep, prevStep, skipTour]);

  return (
    <TourContext.Provider value={value}>
      {children}
    </TourContext.Provider>
  );
}
