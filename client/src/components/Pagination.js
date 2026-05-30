import React from 'react';
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa';

const Pagination = ({ pagination, onPageChange }) => {
  if (!pagination || pagination.totalPages <= 1) return null;

  const { currentPage, totalPages, hasNextPage, hasPrevPage } = pagination;

  // Generate page numbers to show (max 5 pages visible)
  const getPageNumbers = () => {
    const pages = [];
    let start = Math.max(1, currentPage - 2);
    let end = Math.min(totalPages, start + 4);
    if (end - start < 4) start = Math.max(1, end - 4);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  };

  const btnStyle = (active = false, disabled = false) => ({
    padding: '8px 12px',
    borderRadius: 8,
    border: active ? '2px solid #e91e63' : '1px solid #ddd',
    background: active ? '#e91e63' : '#fff',
    color: active ? '#fff' : disabled ? '#ccc' : '#333',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: active ? 700 : 400,
    fontSize: 14,
    minWidth: 40,
    textAlign: 'center',
  });

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 4, padding: '20px 0', flexWrap: 'wrap' }}>
      <button style={btnStyle(false, !hasPrevPage)} onClick={() => hasPrevPage && onPageChange(currentPage - 1)} disabled={!hasPrevPage}>
        <FaChevronLeft />
      </button>

      {getPageNumbers()[0] > 1 && (
        <>
          <button style={btnStyle(false)} onClick={() => onPageChange(1)}>1</button>
          {getPageNumbers()[0] > 2 && <span style={{ padding: '0 4px', color: '#999' }}>...</span>}
        </>
      )}

      {getPageNumbers().map(page => (
        <button key={page} style={btnStyle(page === currentPage)} onClick={() => onPageChange(page)}>
          {page}
        </button>
      ))}

      {getPageNumbers().slice(-1)[0] < totalPages && (
        <>
          {getPageNumbers().slice(-1)[0] < totalPages - 1 && <span style={{ padding: '0 4px', color: '#999' }}>...</span>}
          <button style={btnStyle(false)} onClick={() => onPageChange(totalPages)}>{totalPages}</button>
        </>
      )}

      <button style={btnStyle(false, !hasNextPage)} onClick={() => hasNextPage && onPageChange(currentPage + 1)} disabled={!hasNextPage}>
        <FaChevronRight />
      </button>

      <span style={{ fontSize: 12, color: '#999', marginLeft: 8 }}>
        {pagination.total} items
      </span>
    </div>
  );
};

// Infinite scroll hook for mobile
export const useInfiniteScroll = (pagination, loadMore) => {
  const handleScroll = () => {
    if (
      window.innerHeight + document.documentElement.scrollTop >=
      document.documentElement.offsetHeight - 200
    ) {
      if (pagination?.hasNextPage) loadMore();
    }
  };

  React.useEffect(() => {
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
    // eslint-disable-next-line
  }, [pagination?.hasNextPage]);
};

export default Pagination;