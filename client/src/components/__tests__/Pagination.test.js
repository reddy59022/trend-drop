import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Pagination from '../Pagination';

beforeEach(() => { jest.clearAllMocks(); });

describe('Pagination', () => {
  test('returns null when totalPages <= 1', () => {
    const { container } = render(<MemoryRouter><Pagination currentPage={1} totalPages={1} onPageChange={() => {}} /></MemoryRouter>);
    expect(container.firstChild).toBeNull();
  });
  test('previous button is disabled on the first page', () => {
    render(<MemoryRouter><Pagination currentPage={1} totalPages={5} onPageChange={() => {}} /></MemoryRouter>);
    expect(screen.getByLabelText('Previous page')).toBeDisabled();
  });
  test('next button is disabled on the last page', () => {
    render(<MemoryRouter><Pagination currentPage={5} totalPages={5} onPageChange={() => {}} /></MemoryRouter>);
    expect(screen.getByLabelText('Next page')).toBeDisabled();
  });
  test('shows the active page with aria-current', () => {
    render(<MemoryRouter><Pagination currentPage={3} totalPages={10} onPageChange={() => {}} /></MemoryRouter>);
    expect(screen.getByRole('button', { current: 'page' })).toHaveTextContent('3');
  });
  test('clicking a page calls onPageChange with that page', () => {
    const onPageChange = jest.fn();
    render(<MemoryRouter><Pagination currentPage={1} totalPages={5} onPageChange={onPageChange} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });
  test('shows an ellipsis when pages exceed the window', () => {
    render(<MemoryRouter><Pagination currentPage={5} totalPages={20} onPageChange={() => {}} /></MemoryRouter>);
    expect(screen.getAllByText('...').length).toBeGreaterThanOrEqual(1);
  });
});
