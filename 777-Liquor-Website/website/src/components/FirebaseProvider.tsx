import { onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { auth, BOOTSTRAPPED_ADMIN_EMAIL, db, googleProvider } from "../lib/firebase";

type FirebaseContextValue = {
  user: User | null;
  authReady: boolean;
  isAdmin: boolean;
  signInWithGoogle: () => Promise<void>;
  signOutUser: () => Promise<void>;
};

const FirebaseContext = createContext<FirebaseContextValue>({
  user: null,
  authReady: false,
  isAdmin: false,
  signInWithGoogle: async () => {},
  signOutUser: async () => {},
});

export function FirebaseProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      if (!nextUser) {
        setIsAdmin(false);
        setAuthReady(true);
        return;
      }

      if (
        nextUser.emailVerified &&
        nextUser.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase()
      ) {
        setIsAdmin(true);
        setAuthReady(true);
        return;
      }

      try {
        const adminDoc = await getDoc(doc(db, "admins", nextUser.uid));
        setIsAdmin(adminDoc.exists() && nextUser.emailVerified);
      } catch {
        setIsAdmin(false);
      } finally {
        setAuthReady(true);
      }
    });

    return () => unsubscribe();
  }, []);

  const signInWithGoogle = useCallback(async () => {
    await signInWithPopup(auth, googleProvider);
  }, []);

  const signOutUser = useCallback(async () => {
    await signOut(auth);
  }, []);

  const value = useMemo<FirebaseContextValue>(
    () => ({
      user,
      authReady,
      isAdmin,
      signInWithGoogle,
      signOutUser,
    }),
    [user, authReady, isAdmin, signInWithGoogle, signOutUser],
  );

  return <FirebaseContext.Provider value={value}>{children}</FirebaseContext.Provider>;
}

export function useFirebaseAuth() {
  return useContext(FirebaseContext);
}
