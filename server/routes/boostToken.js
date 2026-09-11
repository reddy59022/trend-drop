    // --- revealAuth: dynamically reveal listings that pass our rules ---
    const revealAuth = async (listing, userId) => {
      if (!listing || !listing.price) return true;
      const listed = listing.listedPrice ?? listing.price;

      // BOOSTED listings are auto-revealed and charge a boost fee BEFORE visibility.
      // Reason: tokenization must surface spend-first listings so buyers see price,
      // and the seller has already committed to the boost spend.
      if (listing.boostFee && listing.boostFee > 0) return true;

      // Non-boosted listings: check token requirements.
      const rules = await getBoostRules();
      for (const segment of rules.segments) {
        const lbl = segment.label?.toLowerCase() ?? '';
        // segment 0 = no requirement
        if (lbl.includes('no minimum')) continue;
        // Strip numeric threshold and normalize
        const num = parseFloat((segment.threshold ?? '').replace(/[^0-9.]/g, ''));
        if (!isNaN(num) && num > 0) {
          // Below threshold: authorize with tokens
          const bought = await hasTokensOwned(userId, segment.tokenId);
          if (!bought && !await hasBalance(userId, segment.tokenId, segment.threshold)) {
            return false; // not visible until user has tokens
          }
        }
      }

      return true;
    };