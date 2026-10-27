'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/atoms/AlertDialog/AlertDialog';

const UNSAVED_CHANGES_TITLE = 'Leave without saving?';
const UNSAVED_CHANGES_STAY_LABEL = 'Keep editing';
const UNSAVED_CHANGES_LEAVE_LABEL = 'Discard changes';

/** Asks before a click takes the seller away from a form with unsaved edits. */
export function UnsavedChangesDialog({
  open,
  subject,
  onStay,
  onLeave,
}: {
  open: boolean;
  /** What would be lost, e.g. "storefront". */
  subject: string;
  onStay: () => void;
  onLeave: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onStay()}>
      <AlertDialogContent data-testid="unsaved-changes-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{UNSAVED_CHANGES_TITLE}</AlertDialogTitle>
          <AlertDialogDescription>
            You have unsaved changes to your {subject}. If you leave now, they will be lost.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{UNSAVED_CHANGES_STAY_LABEL}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onLeave}>
            {UNSAVED_CHANGES_LEAVE_LABEL}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
