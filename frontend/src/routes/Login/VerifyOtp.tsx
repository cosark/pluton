import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import classes from './Login.module.scss';
import Logo from '../../components/common/Logo/Logo';
import { APP_NAME } from '../../utils/constants';
import Icon from '../../components/common/Icon/Icon';
import { useVerifyTwoFactorOTP } from '../../services/settings';
import PageTitle from '../../components/App/PageTitle/PageTitle';

const VerifyOtp = () => {
   const [error, setError] = useState<string>('');
   const [code, setCode] = useState<string>('');
   const navigate = useNavigate();
   const verifyMutation = useVerifyTwoFactorOTP();

   const showError = (msg: string) => {
      setError(msg);
      setTimeout(() => setError(''), 5000);
   };

   const handleVerify = () => {
      if (!code.trim()) {
         showError('Please Insert the Code from your Authenticator App or a Recovery Code.');
         return;
      }

      verifyMutation.mutate(
         { code: code.trim() },
         {
            onError: (error: Error) => {
               // The pending login session is gone (expired or too many attempts)
               if (error.message.toLowerCase().includes('log in again')) {
                  navigate('/login');
                  return;
               }
               showError(error.message);
            },
         },
      );
   };

   return (
      <div className={classes.loginPage}>
         <PageTitle title={`Two-Factor Authentication`} />
         <div className={classes.loginLogo}>
            <h3>
               <Logo size={36} /> <span>{APP_NAME}</span>
            </h3>
         </div>
         <div className={classes.container}>
            <form
               className="loginForm"
               onSubmit={(e) => {
                  e.preventDefault();
                  handleVerify();
               }}
            >
               <div className={classes.loginInput}>
                  <Icon type="password" classes={classes.loginInputIcon} />
                  <input
                     className={`${error ? 'inputError' : ''}`}
                     type="text"
                     value={code}
                     placeholder="Authentication Code"
                     autoComplete="one-time-code"
                     autoFocus
                     onChange={(event) => setCode(event.target.value)}
                  />
               </div>
               <button className={classes.loginButton} type="submit" disabled={verifyMutation.isPending}>
                  {verifyMutation.isPending ? 'Verifying...' : 'Verify'}
               </button>
               {error && <div className={classes.loginErrorMsg}>{error}</div>}
               <div className={classes.loginBackLink}>
                  <Link to="/login">Back to Login</Link>
               </div>
            </form>
         </div>
      </div>
   );
};

export default VerifyOtp;
