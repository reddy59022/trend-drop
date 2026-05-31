import React from 'react';
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa';

const Pagination = ({ currentPage, totalPages, onPageChange }) => {
  if (totalPages <= 1) return null;

  const getPageNumbers = () => {
    const pages = [];
    const maxVisible = 5;

    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push('...');
      
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);
      
      for (let i = start; i <= end; i++) pages.push(i);
      
      if (currentPage < totalPages - 2) pages.push('...');
      pages.push(totalPages);
    }
    return pages;
  };

  return (
    <nav className="pagination" aria-label="Pagination">
      <button
        className="btn btn-sm btn-outline"
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage <= 1}
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
            className={`btn btn-sm ${page === currentPage ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => onPageChange(page)}
            style={{
              minWidth: 36,
              fontWeight: page === currentPage ? 700 : 500,
            }}
            aria-label={`Page ${page}`}
            aria-current={page === currentPage ? 'page' : undefined}
          >
            {page}
          </button>
        )
      ))}

      <button
        className="btn btn-sm btn-outline"
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage >= totalPages}
        aria-label="Next page"
      >
        <FaChevronRight size={12} />
      </button>
    </nav>
  );
};

export default Pagination;