import { ProgressSteps } from '@/molecules/ProgressSteps/ProgressSteps';

const CHECKOUT_STEPS = ['Cart', 'Checkout', 'Payment'] as const;

export function MarketplaceCheckoutSteps({
  currentStep,
  completed = false,
}: {
  currentStep: 1 | 2 | 3;
  completed?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={
        completed
          ? 'Checkout complete'
          : `Checkout progress: step ${currentStep} of 3, ${CHECKOUT_STEPS[currentStep - 1]}`
      }
      className="w-full md:w-[200px] lg:w-[320px] xl:w-[416px]"
    >
      <ProgressSteps
        currentStep={completed ? CHECKOUT_STEPS.length + 1 : currentStep}
        totalSteps={CHECKOUT_STEPS.length}
        className="static mt-0 max-w-none flex-none"
      />
    </div>
  );
}
