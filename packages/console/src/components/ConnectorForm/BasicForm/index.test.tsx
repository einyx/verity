import { fireEvent, render, waitFor } from '@testing-library/react';
import type * as React from 'react';
import { useEffect } from 'react';
import { FormProvider, useForm } from 'react-hook-form';

import type { ConnectorFormType } from '@/types/connector';
import { SyncProfileMode } from '@/types/connector';

import BasicForm from '.';

jest.mock('@/components/ImageInputs', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/consts/env', () => ({
  isCloud: false,
}));

jest.mock('@/ds-components/FormField', () => ({
  __esModule: true,
  default: ({ children }: { readonly children: React.ReactNode }) => <div>{children}</div>,
}));

const defaultValues: ConnectorFormType = {
  target: 'google',
  connectorId: 'google',
  syncProfile: SyncProfileMode.OnlyAtRegister,
  jsonConfig: '{}',
  formConfig: {},
  rawConfig: {},
  enableTokenStorage: false,
};

type Props = {
  readonly isConnectorIdEditable?: boolean;
};

function FormWrapper({ children }: Props & { readonly children: React.ReactNode }) {
  const methods = useForm<ConnectorFormType>({ mode: 'onChange' });
  const { reset } = methods;

  useEffect(() => {
    reset(defaultValues);
  }, [reset]);

  return (
    <FormProvider {...methods}>
      <form>{children}</form>
    </FormProvider>
  );
}

const getConnectorIdInput = (container: HTMLElement) =>
  container.querySelector<HTMLInputElement>('input[name="connectorId"]');

const waitForConnectorIdInput = async (container: HTMLElement) => {
  await waitFor(() => {
    expect(getConnectorIdInput(container)).not.toBeNull();
  });

  return getConnectorIdInput(container)!;
};

describe('BasicForm', () => {
  it('shows the connector ID field when it is editable', () => {
    const { container } = render(<BasicForm isConnectorIdEditable />, { wrapper: FormWrapper });

    expect(getConnectorIdInput(container)).not.toBeNull();
  });

  it('hides the connector ID field by default', () => {
    const { container } = render(<BasicForm />, { wrapper: FormWrapper });

    expect(getConnectorIdInput(container)).toBeNull();
  });

  it('does not offer the connector ID when editing an existing connector', () => {
    // The connector ID is part of the callback URI registered at the IdP, so it cannot change
    // after the connector is created.
    const { container } = render(<BasicForm isStandard isAllowEditTarget />, {
      wrapper: FormWrapper,
    });

    expect(getConnectorIdInput(container)).toBeNull();
  });

  it('rejects a connector ID that is not a valid path segment', async () => {
    const { container } = render(<BasicForm isConnectorIdEditable />, { wrapper: FormWrapper });

    const input = await waitForConnectorIdInput(container);
    fireEvent.change(input, { target: { value: 'not a valid/id' } });

    await waitFor(() => {
      expect(getConnectorIdInput(container)?.getAttribute('aria-invalid')).toBe('true');
    });
  });

  it('accepts a connector ID made of letters, digits, dots, dashes and underscores', async () => {
    const { container } = render(<BasicForm isConnectorIdEditable />, { wrapper: FormWrapper });

    const input = await waitForConnectorIdInput(container);
    fireEvent.change(input, { target: { value: 'my_connector-1.0' } });

    await waitFor(() => {
      expect(getConnectorIdInput(container)?.getAttribute('aria-invalid')).toBe('false');
    });
  });

  it('renders the connector ID as a plain text input', () => {
    const { container } = render(<BasicForm isConnectorIdEditable />, { wrapper: FormWrapper });

    expect(getConnectorIdInput(container)?.getAttribute('type')).toBe('text');
  });

  it('keeps the connector ID separate from the IdP name', () => {
    const { container } = render(<BasicForm isConnectorIdEditable />, { wrapper: FormWrapper });

    const target = container.querySelector<HTMLInputElement>('input[name="target"]');

    expect(target?.value).toBe('google');
    expect(getConnectorIdInput(container)?.value).toBe('google');
  });
});
