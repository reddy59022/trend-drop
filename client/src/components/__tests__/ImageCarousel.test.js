import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { routerFuture } from '../../test-utils';
import ImageCarousel from '../ImageCarousel';

const imgs = ['http://a/1.jpg', 'http://a/2.jpg', 'http://a/3.jpg'];

describe('ImageCarousel', () => {
  test('shows the first image with alt text', () => {
    render(<MemoryRouter future={routerFuture}><ImageCarousel images={imgs} /></MemoryRouter>);
    expect(screen.getByRole('img')).toHaveAttribute('alt', 'Product image 1');
  });
  test('displays the 1 / 3 counter', () => {
    render(<MemoryRouter future={routerFuture}><ImageCarousel images={imgs} /></MemoryRouter>);
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });
  test('a broken image URL swaps to the placeholder and clears the eternal skeleton', () => {
    render(<MemoryRouter future={routerFuture}><ImageCarousel images={imgs} /></MemoryRouter>);
    const img = screen.getByRole('img');
    // Before load: hidden behind the skeleton (opacity 0).
    expect(img).toHaveStyle({ opacity: 0 });
    fireEvent.error(img);
    expect(img.getAttribute('src')).toContain('data:image/svg+xml');
    // Skeleton gate is cleared even though onLoad never fired.
    expect(img).toHaveStyle({ opacity: 1 });
  });
  test('clicking next advances the image and updates counter', () => {
    render(<MemoryRouter future={routerFuture}><ImageCarousel images={imgs} /></MemoryRouter>);
    fireEvent.click(screen.getByLabelText('Next image'));
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('alt', 'Product image 2');
  });
  test('clicking prev wraps to the last image', () => {
    render(<MemoryRouter future={routerFuture}><ImageCarousel images={imgs} /></MemoryRouter>);
    fireEvent.click(screen.getByLabelText('Previous image'));
    expect(screen.getByText('3 / 3')).toBeInTheDocument();
  });
  test('next on the last image wraps to the first', () => {
    render(<MemoryRouter future={routerFuture}><ImageCarousel images={imgs} /></MemoryRouter>);
    fireEvent.click(screen.getByLabelText('Next image'));
    fireEvent.click(screen.getByLabelText('Next image'));
    fireEvent.click(screen.getByLabelText('Next image'));
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });
  test('shows a placeholder image when there are no images', () => {
    render(<MemoryRouter future={routerFuture}><ImageCarousel images={[]} /></MemoryRouter>);
    expect(screen.getByRole('img')).toHaveAttribute('alt', 'No visual');
  });
});
