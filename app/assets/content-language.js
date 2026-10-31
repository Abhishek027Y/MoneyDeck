'use strict';

window.MDContentLanguage = (() => {
  const messages = {
    comments: {
      hi: {
        'Please re-check the principal amount against your passbook — our text comparison found Rs. 1,45,000 on the receipt.':
          'कृपया अपनी पासबुक में मूलधन की राशि दोबारा जाँचें — रसीद के पाठ की तुलना में हमें ₹1,45,000 मिला है।',
        'Institution reply': 'संस्थान का उत्तर',
        'No officer comments yet.': 'अभी तक अधिकारी की कोई टिप्पणी नहीं है।',
      },
      mr: {
        'Please re-check the principal amount against your passbook — our text comparison found Rs. 1,45,000 on the receipt.':
          'कृपया तुमच्या पासबुकमधील मूळ रकमेची पुन्हा तपासणी करा — पावतीच्या मजकूराच्या तुलनेत आम्हाला ₹1,45,000 आढळले.',
        'Institution reply': 'संस्थेचे उत्तर',
        'No officer comments yet.': 'अधिकाऱ्यांच्या अद्याप कोणत्याही टिप्पण्या नाहीत.',
      },
    },
    alerts: {
      hi: {
        'Reminder: Upload original FD receipt PDFs': 'अनुस्मारक: मूल FD रसीद की PDF अपलोड करें',
        'Notice: Reminder: Upload original FD receipt PDFs': 'सूचना: मूल FD रसीद की PDF अपलोड करें',
        'All institutions must upload the original PDF receipt for every submitted FDR so the review workspace can compare entered data with the document text layer. FDRs without receipts remain pending.':
          'सभी संस्थानों को प्रत्येक जमा किए गए FDR की मूल PDF रसीद अपलोड करनी होगी, ताकि समीक्षा कार्यक्षेत्र दर्ज किए गए डेटा की तुलना दस्तावेज़ के पाठ से कर सके। रसीद के बिना FDR लंबित रहेंगे।',
        'Active alerts': 'सक्रिय अलर्ट',
        'Snoozed (will re-appear)': 'स्थगित (फिर दिखाई देंगे)',
        'Full history': 'पूरा इतिहास',
        'No active alerts. Maturity reminders arrive automatically at 30, 15, 7 and 1 day(s) before maturity — and daily when overdue.':
          'कोई सक्रिय अलर्ट नहीं है। परिपक्वता से 30, 15, 7 और 1 दिन पहले तथा देय तिथि बीतने पर प्रतिदिन अनुस्मारक अपने-आप आते हैं।',
        'Nothing snoozed.': 'कोई अलर्ट स्थगित नहीं है।',
        'No history yet.': 'अभी कोई इतिहास नहीं है।',
        'CRITICAL — cannot be snoozed': 'गंभीर — स्थगित नहीं किया जा सकता',
        High: 'उच्च',
        Normal: 'सामान्य',
        Mandatory: 'अनिवार्य',
        'snoozed until': 'तक स्थगित',
        'Notice:': 'सूचना:',
      },
      mr: {
        'Reminder: Upload original FD receipt PDFs': 'स्मरणपत्र: मूळ FD पावतीची PDF अपलोड करा',
        'Notice: Reminder: Upload original FD receipt PDFs': 'सूचना: मूळ FD पावतीची PDF अपलोड करा',
        'All institutions must upload the original PDF receipt for every submitted FDR so the review workspace can compare entered data with the document text layer. FDRs without receipts remain pending.':
          'प्रत्येक सादर केलेल्या FDR ची मूळ PDF पावती सर्व संस्थांनी अपलोड करावी, जेणेकरून पुनरावलोकन कार्यक्षेत्रात नोंदवलेल्या माहितीची दस्तऐवजातील मजकुराशी तुलना करता येईल. पावती नसलेले FDR प्रलंबित राहतील.',
        'Active alerts': 'सक्रिय सूचना',
        'Snoozed (will re-appear)': 'पुढे ढकललेल्या (पुन्हा दिसतील)',
        'Full history': 'संपूर्ण इतिहास',
        'No active alerts. Maturity reminders arrive automatically at 30, 15, 7 and 1 day(s) before maturity — and daily when overdue.':
          'कोणतीही सक्रिय सूचना नाही. मुदतपूर्तीच्या 30, 15, 7 आणि 1 दिवस आधी तसेच मुदत उलटल्यानंतर दररोज स्मरणपत्रे आपोआप येतात.',
        'Nothing snoozed.': 'कोणतीही सूचना पुढे ढकललेली नाही.',
        'No history yet.': 'अद्याप इतिहास नाही.',
        'CRITICAL — cannot be snoozed': 'गंभीर — पुढे ढकलता येणार नाही',
        High: 'उच्च',
        Normal: 'सामान्य',
        Mandatory: 'अनिवार्य',
        'snoozed until': 'पर्यंत पुढे ढकलले',
        'Notice:': 'सूचना:',
      },
    },
  };

  function translateText(text, locale, scope) {
    if (locale === 'en' || !messages[scope] || !messages[scope][locale]) return text;
    const catalog = messages[scope][locale];
    if (catalog[text] !== undefined) return catalog[text];
    if (scope !== 'alerts') return text;

    let match = text.match(/^Active alerts \((\d+)\)$/);
    if (match) {
      return locale === 'hi'
        ? `सक्रिय अलर्ट (${match[1]})`
        : `सक्रिय सूचना (${match[1]})`;
    }

    match = text.match(/^FDR (.+) matures in (\d+) days?$/);
    if (match) {
      return locale === 'hi'
        ? `FDR ${match[1]} की परिपक्वता में ${match[2]} दिन शेष`
        : `FDR ${match[1]} ची मुदत ${match[2]} दिवसांत पूर्ण होईल`;
    }

    match = text.match(/^OVERDUE: FDR (.+) matured (\d+) day\(s\) ago$/);
    if (match) {
      return locale === 'hi'
        ? `देय तिथि बीत गई: FDR ${match[1]} की परिपक्वता को ${match[2]} दिन हो चुके हैं`
        : `मुदत संपली: FDR ${match[1]} ची मुदत उलटून ${match[2]} दिवस झाले`;
    }

    match = text.match(/^FDR (.+) matured in (\d+) day\(s\) ago$/);
    if (match) {
      return locale === 'hi'
        ? `FDR ${match[1]} की परिपक्वता को ${match[2]} दिन हो चुके हैं`
        : `FDR ${match[1]} ची मुदत उलटून ${match[2]} दिवस झाले`;
    }

    match = text.match(/^(.+) FDR (.+) \((.+)\) matures on (.+)\. Submit a renewal if required\.$/);
    if (match) {
      return locale === 'hi'
        ? `${match[1]} का FDR ${match[2]} (${match[3]}) दिनांक ${match[4]} को परिपक्व होगा। आवश्यकता होने पर नवीनीकरण जमा करें।`
        : `${match[1]} चे FDR ${match[2]} (${match[3]}) दिनांक ${match[4]} रोजी मुदतपूर्ती होईल. आवश्यक असल्यास नूतनीकरण सादर करा.`;
    }

    match = text.match(/^(.+) FDR (.+) matured on (.+) and no renewal is recorded\. Regulatory exposure\.$/);
    if (match) {
      return locale === 'hi'
        ? `${match[1]} का FDR ${match[2]} दिनांक ${match[3]} को परिपक्व हुआ और कोई नवीनीकरण दर्ज नहीं है। नियामकीय जोखिम।`
        : `${match[1]} चे FDR ${match[2]} दिनांक ${match[3]} रोजी मुदतपूर्ती झाले असून नूतनीकरण नोंदलेले नाही. नियामक जोखीम.`;
    }

    match = text.match(/^Verification pending: (.+)$/);
    if (match) return locale === 'hi' ? `सत्यापन लंबित: ${match[1]}` : `पडताळणी प्रलंबित: ${match[1]}`;

    match = text.match(/^Correction required: (.+)$/);
    if (match) return locale === 'hi' ? `सुधार आवश्यक: ${match[1]}` : `दुरुस्ती आवश्यक: ${match[1]}`;

    match = text.match(/^Release request (.+): (.+)$/);
    if (match) {
      return locale === 'hi'
        ? `रिलीज़ अनुरोध ${match[1]}: ${match[2]}`
        : `मुक्तता विनंती ${match[1]}: ${match[2]}`;
    }

    match = text.match(/^(.+): FDR (.+) has been awaiting verification since (.+)\.$/);
    if (match) {
      return locale === 'hi'
        ? `${match[1]}: FDR ${match[2]} ${match[3]} से सत्यापन की प्रतीक्षा में है।`
        : `${match[1]}: FDR ${match[2]} ${match[3]} पासून पडताळणीच्या प्रतीक्षेत आहे.`;
    }

    if (text.startsWith('Officer comment: ')) {
      return `${locale === 'hi' ? 'अधिकारी की टिप्पणी:' : 'अधिकाऱ्यांची टिप्पणी:'}${text.slice(17)}`;
    }

    if (text.startsWith('snoozed until ')) {
      return `${locale === 'hi' ? 'तक स्थगित' : 'पर्यंत पुढे ढकलले'} ${text.slice(14)}`;
    }

    if (text.startsWith('Notice: ')) return `${catalog['Notice:'] || 'Notice:'} ${text.slice(8)}`;
    return text;
  }

  function apply(select, scope) {
    const locale = select.value;
    document.documentElement.lang = locale;
    document.querySelectorAll(`[data-content-translation="${scope}"]`).forEach((element) => {
      const original = element.dataset.translationOriginal ?? element.textContent;
      element.dataset.translationOriginal = original;
      element.textContent = translateText(original, locale, scope);
    });
  }

  function bind(select, scope) {
    const saved = localStorage.getItem('md_college_language') || 'en';
    select.value = ['en', 'hi', 'mr'].includes(saved) ? saved : 'en';
    select.addEventListener('change', () => {
      localStorage.setItem('md_college_language', select.value);
      apply(select, scope);
    });
    apply(select, scope);
  }

  return { bind };
})();
