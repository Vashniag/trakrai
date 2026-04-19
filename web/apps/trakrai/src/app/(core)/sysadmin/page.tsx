import { redirect } from 'next/navigation';

const SysadminLandingPage = () => {
  redirect('/access-control/users');
};

export default SysadminLandingPage;
