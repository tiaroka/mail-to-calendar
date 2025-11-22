const AuthWrapper = () => {
  const [content, setContent] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [config, setConfig] = React.useState(null);

  React.useEffect(() => {
    // 設定を取得してから初期化
    const loadConfigAndInitialize = async () => {
      try {
        const configResponse = await fetch('/api/config');
        const configData = await configResponse.json();
        setConfig(configData);
        initialize(configData);
      } catch (err) {
        console.error('Failed to load config:', err);
        setError('設定の読み込みに失敗しました。');
        setIsLoading(false);
      }
    };

    const initialize = (configData) => {
      console.log('Initializing Google Identity Services...');
      try {
        google.accounts.id.initialize({
          client_id: configData.googleClientId,
          callback: (response) => handleCredentialResponse(response, configData),
          auto_select: true,
          context: 'signin'
        });

        google.accounts.id.renderButton(
          document.getElementById('google-signin'),
          { 
            theme: 'outline', 
            size: 'large', 
            text: 'signin_with',
            width: '240'
          }
        );

        google.accounts.id.prompt((notification) => {
          console.log('Prompt notification:', notification);
          if (notification.isNotDisplayed()) {
            console.log('Prompt not displayed:', notification.getNotDisplayedReason());
            setError('ログインプロンプトを表示できませんでした。');
            setIsLoading(false);
          } else if (notification.isSkippedMoment()) {
            console.log('Prompt skipped:', notification.getSkippedReason());
            setError('ログインが必要です。');
            setIsLoading(false);
          } else {
            console.log('Prompt displayed successfully');
          }
        });
      } catch (err) {
        console.error('Initialization error:', err);
        setError('認証の初期化に失敗しました。');
        setIsLoading(false);
      }
    };

    const handleCredentialResponse = async (response, configData) => {
      console.log('Credential response received');
      try {
        const token = response.credential;
        console.log('Token acquired');

        const apiResponse = await fetch(configData.serviceUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          },
          mode: 'cors',
          credentials: 'include'
        });

        console.log('Response status:', apiResponse.status);

        if (apiResponse.ok) {
          const data = await apiResponse.text();
          setContent(data);
        } else {
          throw new Error(`アクセスが拒否されました（ステータスコード: ${apiResponse.status}）`);
        }
      } catch (err) {
        setError(err.message);
        console.error('Error:', err);
      } finally {
        setIsLoading(false);
      }
    };

    loadConfigAndInitialize();
  }, []);

  return React.createElement('div', { 
    style: { 
      padding: '2rem',
      maxWidth: '600px',
      margin: '0 auto',
      fontFamily: 'sans-serif'
    } 
  }, [
    isLoading && React.createElement('div', {
      key: 'loading',
      style: { textAlign: 'center', marginBottom: '1rem' }
    }, '読み込み中...'),

    error && React.createElement('div', {
      key: 'error',
      style: {
        padding: '1rem',
        backgroundColor: '#fee2e2',
        color: '#dc2626',
        borderRadius: '0.25rem',
        marginBottom: '1rem'
      }
    }, `エラー: ${error}`),

    !content && React.createElement('div', {
      key: 'signin',
      id: 'google-signin',
      style: { textAlign: 'center', marginBottom: '1rem' }
    }),

    content && React.createElement('div', {
      key: 'content',
      dangerouslySetInnerHTML: { __html: content }
    })
  ]);
};

window.onload = () => {
  ReactDOM.render(
    React.createElement(AuthWrapper),
    document.getElementById('root')
  );
};