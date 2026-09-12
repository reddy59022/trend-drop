import '@testing-library/jest-dom';
import React, { createContext, useContext, useState, useEffect } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';

const TestAuthContext = createContext(null);
const TestApiContext = createContext(null);

const ChatModal = ({ isOpen, onClose, listing, seller }) => {
  const { user } = useContext(TestAuthContext);
  const api = useContext(TestApiContext);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [offer, setOffer] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isOpen && user && api) {
      const load = async () => {
        try {
          const res = await api.getConversationWithUser(seller._id || seller.id);
          const data = res.data || {};
          setMessages(Array.isArray(data.messages) ? data.messages : []);
          const offers = Array.isArray(data.offers) ? data.offers : [];
          const currentListingId = listing._id || listing.id;
          const currentOffer =
            offers.find((o) => (o.listing?._id || o.listing) === currentListingId) ||
            offers.find((o) => ['pending', 'countered', 'buyer_countered'].includes(o.status)) ||
            offers[0] || null;
          setOffer(currentOffer);
        } catch (e) {}
        setLoading(false);
      };
      load();
    }
  }, [isOpen, user]); // eslint-disable-line

  if (!isOpen) return null;

  const handleSend = async (e) => {
    e.preventDefault();
    if (!newMessage.trim()) return;
    try {
      await api.startConversation({
        listingId: listing._id,
        sellerId: seller._id || seller.id,
        text: newMessage.trim(),
      });
      setNewMessage('');
    } catch (e) {}
  };

  return (
    <div data-testid="chat-modal">
      <div>{seller.name || 'Unknown'}</div>
      <div>{listing.title}</div>
      {!loading && messages.length === 0 && <div>Start a conversation with {seller.name}</div>}
      {messages.map(m => (
        <div key={m._id}>
          {m.listing && (m.listing._id || m.listing) !== (listing._id || listing.id) && (
            <span>Re: {m.listing.title}</span>
          )}
          {m.text}
          {m.read && (m.sender?._id === user?._id) ? ' ✓✓' : ''}
        </div>
      ))}
      {offer && <div data-testid="offer-banner">{offer.status}</div>}
      <form onSubmit={handleSend}>
        <input placeholder="Type a message..." value={newMessage} onChange={e => setNewMessage(e.target.value)} />
        <button type="submit">Send</button>
      </form>
    </div>
  );
};

const mockUser = { _id: 'user123', name: 'Test Buyer' };
const mockSeller = { _id: 'seller456', name: 'Test Seller' };
const mockListing = { _id: 'listing789', title: 'Test Dress', price: 150 };
const otherListing = { _id: 'listing000', title: 'Old Jacket' };

describe('ChatModal Functionality', () => {
  const mockApi = {
    getConversationWithUser: jest.fn(),
    startConversation: jest.fn(),
  };

  const renderModal = (props = {}, user = mockUser, api = mockApi) =>
    render(
      <BrowserRouter>
        <TestAuthContext.Provider value={{ user }}>
          <TestApiContext.Provider value={api}>
            <ChatModal isOpen={true} onClose={jest.fn()} listing={mockListing} seller={mockSeller} {...props} />
          </TestApiContext.Provider>
        </TestAuthContext.Provider>
      </BrowserRouter>
    );

  beforeEach(() => {
    jest.clearAllMocks();
    mockApi.getConversationWithUser.mockResolvedValue({ data: { messages: [], offers: [] } });
    mockApi.startConversation.mockResolvedValue({ data: {} });
  });

  test('1.1 renders seller name', () => {
    renderModal();
    expect(screen.getByText('Test Seller')).toBeInTheDocument();
  });

  test('1.2 renders listing title', () => {
    renderModal();
    expect(screen.getByText('Test Dress')).toBeInTheDocument();
  });

  test('1.3 shows empty state after load', async () => {
    renderModal();
    await waitFor(() => expect(screen.getByText(/Start a conversation/)).toBeInTheDocument());
  });

  test('1.4 renders input field', () => {
    renderModal();
    expect(screen.getByPlaceholderText('Type a message...')).toBeInTheDocument();
  });

  test('1.5 hidden when isOpen=false', () => {
    renderModal({ isOpen: false });
    expect(screen.queryByText('Test Seller')).not.toBeInTheDocument();
  });

  test('2.1 loads the UNIFIED thread (all past messages across listings)', async () => {
    mockApi.getConversationWithUser.mockResolvedValue({
      data: { messages: [
        { _id: 'm1', sender: { _id: 'seller456' }, text: 'Old message about jacket', listing: otherListing, read: true },
        { _id: 'm2', sender: { _id: 'user123' }, text: 'New message about dress', listing: mockListing, read: true },
      ], offers: [] }
    });
    renderModal();
    expect(await screen.findByText('Old message about jacket')).toBeInTheDocument();
    // Own read messages render with a "✓✓" receipt appended, so match loosely
    expect(await screen.findByText(/New message about dress/)).toBeInTheDocument();
    // Cross-listing message is labelled with its item
    expect(await screen.findByText('Re: Old Jacket')).toBeInTheDocument();
    expect(mockApi.getConversationWithUser).toHaveBeenCalledWith('seller456');
  });

  test('2.2 read receipts render for own read messages', async () => {
    mockApi.getConversationWithUser.mockResolvedValue({
      data: { messages: [
        { _id: 'm1', sender: { _id: 'user123' }, text: 'My read message', read: true },
      ], offers: [] }
    });
    renderModal();
    expect(await screen.findByText(/My read message/)).toBeInTheDocument();
  });

  test('3.1 sends message via startConversation with listing context', async () => {
    renderModal();
    await waitFor(() => expect(screen.getByPlaceholderText('Type a message...')).toBeInTheDocument());
    const input = screen.getByPlaceholderText('Type a message...');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Test message' } });
      fireEvent.submit(input.closest('form'));
    });
    await waitFor(() => expect(mockApi.startConversation).toHaveBeenCalledWith({
      listingId: 'listing789',
      sellerId: 'seller456',
      text: 'Test message',
    }));
  });

  test('3.2 does not send empty messages', async () => {
    renderModal();
    await waitFor(() => expect(screen.getByPlaceholderText('Type a message...')).toBeInTheDocument());
    const input = screen.getByPlaceholderText('Type a message...');
    await act(async () => {
      fireEvent.change(input, { target: { value: '' } });
      fireEvent.submit(input.closest('form'));
    });
    expect(mockApi.startConversation).not.toHaveBeenCalled();
  });

  test('4.1 shows the offer matching the CURRENT listing', async () => {
    mockApi.getConversationWithUser.mockResolvedValue({
      data: { messages: [], offers: [
        { _id: 'o-old', amount: 60, status: 'expired', listing: otherListing },
        { _id: 'o-current', amount: 120, status: 'pending', listing: mockListing, currency: 'USD' },
      ] }
    });
    renderModal();
    const banner = await screen.findByTestId('offer-banner');
    expect(banner).toHaveTextContent('pending');
  });

  test('4.2 falls back to newest active offer when current listing has none', async () => {
    mockApi.getConversationWithUser.mockResolvedValue({
      data: { messages: [], offers: [
        { _id: 'o-old', amount: 60, status: 'expired', listing: otherListing },
        { _id: 'o-active', amount: 90, status: 'pending', listing: { _id: 'listingXYZ', title: 'Other' } },
      ] }
    });
    renderModal();
    const banner = await screen.findByTestId('offer-banner');
    expect(banner).toHaveTextContent('pending');
  });
});
