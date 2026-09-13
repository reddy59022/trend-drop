import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import StarRating from '../StarRating';

describe('StarRating', () => {
  test('renders five star buttons', () => {
    render(<MemoryRouter><StarRating rating={3} onRate={() => {}} /></MemoryRouter>);
    expect(screen.getAllByRole('button')).toHaveLength(5);
  });
  test('each star has an aria-label like "1 star", "2 stars"', () => {
    render(<MemoryRouter><StarRating rating={0} onRate={() => {}} /></MemoryRouter>);
    expect(screen.getByLabelText('1 star')).toBeInTheDocument();
    expect(screen.getByLabelText('5 stars')).toBeInTheDocument();
  });
  test('clicking a star calls onRate with the correct value', () => {
    const onRate = jest.fn();
    render(<MemoryRouter><StarRating rating={0} onRate={onRate} /></MemoryRouter>);
    fireEvent.click(screen.getByLabelText('4 stars'));
    expect(onRate).toHaveBeenCalledWith(4);
  });
  test('readonly stars are disabled and do not invoke onRate', () => {
    const onRate = jest.fn();
    render(<MemoryRouter><StarRating rating={4} onRate={onRate} readonly /></MemoryRouter>);
    fireEvent.click(screen.getByLabelText('1 star'));
    expect(onRate).not.toHaveBeenCalled();
    expect(screen.getByLabelText('1 star')).toBeDisabled();
  });
  test('shows numeric rating in readonly mode', () => {
    render(<MemoryRouter><StarRating rating={4.5} readonly /></MemoryRouter>);
    expect(screen.getByText('4.5')).toBeInTheDocument();
  });
});
