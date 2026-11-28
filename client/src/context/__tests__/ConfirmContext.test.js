import '@testing-library/jest-dom';
import React, { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider, useConfirm } from '../ConfirmContext';

const Harness = () => {
  const confirmDialog = useConfirm();
  const [result, setResult] = useState('none');
  return (
    <main>
      <button type="button" onClick={async () => setResult(String(await confirmDialog({ title: 'Delete listing?', message: 'This cannot be undone.', confirmLabel: 'Delete forever', danger: true })))}>
        Delete
      </button>
      <p>result: {result}</p>
    </main>
  );
};

const open = async () => {
  render(<ConfirmProvider><Harness /></ConfirmProvider>);
  const opener = screen.getByRole('button', { name: 'Delete' });
  opener.focus();
  await userEvent.click(opener);
  return { opener, dialog: await screen.findByRole('alertdialog') };
};

test('the dialog is named by its title and described by its message', async () => {
  const { dialog } = await open();
  expect(dialog).toHaveAccessibleName('Delete listing?');
  expect(dialog).toHaveAccessibleDescription('This cannot be undone.');
});

test('focus starts on Cancel and returns to the opener afterwards', async () => {
  const { opener } = await open();
  const cancel = screen.getByRole('button', { name: 'Cancel' });
  expect(document.activeElement).toBe(cancel);

  await userEvent.click(cancel);
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  expect(document.activeElement).toBe(opener);
});

test('Escape cancels without confirming', async () => {
  await open();
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  expect(screen.getByText('result: false')).toBeInTheDocument();
});

test('Tab stays inside the dialog and confirming resolves true', async () => {
  await open();
  const cancel = screen.getByRole('button', { name: 'Cancel' });
  const confirm = screen.getByRole('button', { name: 'Delete forever' });
  confirm.focus();
  await userEvent.tab();
  expect(document.activeElement).toBe(cancel);
  await userEvent.tab({ shift: true });
  expect(document.activeElement).toBe(confirm);

  await userEvent.click(confirm);
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  expect(screen.getByText('result: true')).toBeInTheDocument();
});
