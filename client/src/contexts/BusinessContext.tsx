import React, { createContext, useContext, useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";

const LS_KEY = "bb_selected_biz_id";

interface Business {
  id: number;
  name: string;
  currentStage?: number | null;
  [key: string]: unknown;
}

interface BusinessContextValue {
  businesses: Business[] | undefined;
  activeBusiness: Business | undefined;
  selectedBizId: number | null;
  setSelectedBizId: (id: number) => void;
  isLoading: boolean;
  refetch: () => void;
}

const BusinessContext = createContext<BusinessContextValue>({
  businesses: undefined,
  activeBusiness: undefined,
  selectedBizId: null,
  setSelectedBizId: () => {},
  isLoading: false,
  refetch: () => {},
});

export function BusinessProvider({ children }: { children: React.ReactNode }) {
  const [selectedBizId, setSelectedBizIdState] = useState<number | null>(() => {
    const stored = localStorage.getItem(LS_KEY);
    return stored ? parseInt(stored, 10) : null;
  });

  const { data: businesses, isLoading, refetch } = trpc.business.listAll.useQuery(undefined, {
    retry: false,
  });

  // Once businesses load, validate stored ID or fall back to first
  useEffect(() => {
    if (!businesses?.length) return;
    const stored = localStorage.getItem(LS_KEY);
    const storedId = stored ? parseInt(stored, 10) : null;
    if (storedId && businesses.some((b) => b.id === storedId)) {
      if (!selectedBizId) setSelectedBizIdState(storedId);
    } else if (!selectedBizId) {
      const firstId = businesses[0].id;
      setSelectedBizIdState(firstId);
      localStorage.setItem(LS_KEY, String(firstId));
    }
  }, [businesses, selectedBizId]);

  function setSelectedBizId(id: number) {
    setSelectedBizIdState(id);
    localStorage.setItem(LS_KEY, String(id));
  }

  const activeBusiness = businesses?.find((b) => b.id === selectedBizId) ?? businesses?.[0];

  return (
    <BusinessContext.Provider
      value={{
        businesses,
        activeBusiness,
        selectedBizId,
        setSelectedBizId,
        isLoading,
        refetch: () => void refetch(),
      }}
    >
      {children}
    </BusinessContext.Provider>
  );
}

export function useActiveBusiness() {
  return useContext(BusinessContext);
}
