import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { builderActions } from '@pages/Chat/builder/store/builderSlice';
import { router } from '@router/router';
import { useAppDispatch } from '@store/hooks';

export default function App() {
  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch(builderActions.resetTransientState());
  }, [dispatch]);

  return <RouterProvider router={router} />;
}
