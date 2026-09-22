import React from 'react';
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa';

const Pagination = ({ currentPage, totalPages, onPageChange }) => {
  const pageCount = Number(totalPages);
  const activePage = Number(currentPage);

  // API responses can be partial while a search is loading or when a legacy
  // endpoint omits pagination metadata. Never render controls with an
  // "undefined" page; wait until the contract is complete instead.
  if (!Number.isInteger(pageCount) || pageCount <= 1 || !Number.isInteger(activePage) || activePage < 1) {
    return null;
  }

  const getPageNumbers = () => {
    const pages = [];
    const maxVisible = 5;

    if (pageCount <= maxVisible) {
      for (let i = 1; i <= pageCount; i++) pages.push(i);
    } else {
      pages.push(1);
      if (activePage > 3) pages.push('...');
      
      const start = Math.max(2, activePage - 1);
      const end = Math.min(pageCount - 1, activePage + 1);
      
      for (let i = start; i <= end; i++) pages.push(i);
      
      if (activePage < pageCount - 2) pages.push('...');
      pages.push(pageCount);
    }
    return pages;
  };

  return (
    <nav className="pagination" aria-label="Pagination">
      <button
        className="btn btn-sm btn-outline"
        onClick={() => onPageChange(activePage - 1)}
        disabled={activePage <= 1}
        aria-label="Previous page"
      >
        <FaChevronLeft size={12} />
      </button>

      {getPageNumbers().map((page, i) => (
        page === '...' ? (
          <span key={`ellipsis-${i}`} style={{ color: 'var(--td-text-tertiary)', padding: '0 4px' }}>...</span>
        ) : (
          <button
            key={page}
            className={`btn btn-sm ${page === activePage ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => onPageChange(page)}
            style={{
              minWidth: 36,
              fontWeight: page === activePage ? 700 : 500,
            }}
            aria-label={`Page ${page}`}
            aria-current={page === activePage ? 'page' : undefined}
          >
            {page}
          </button>
        )
      ))}

      <button
        className="btn btn-sm btn-outline"
        onClick={() => onPageChange(activePage + 1)}
        disabled={activePage >= pageCount}
        aria-label="Next page"
      >
        <FaChevronRight size={12} />
      </button>
    </nav>
  );
};

export default Pagination;